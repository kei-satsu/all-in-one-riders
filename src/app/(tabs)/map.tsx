import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LeafletMap from '../../components/leaflet-map';
import { PageLoadingSkeleton } from '../../components/page-loading-skeleton';
import type { MapCoordinate, SenderLocation } from '../../components/leaflet-map.types';
import { supabase } from '../../lib/supabase';
import { useAppTheme, useThemeStyles } from '../../lib/theme-provider';

type SearchMode = 'senders' | 'places';

type PhotonFeature = {
  geometry: {
    coordinates: [number, number];
  };
  properties: {
    osm_type?: string;
    osm_id?: number;
    name?: string;
    housenumber?: string;
    street?: string;
    district?: string;
    city?: string;
    state?: string;
    country?: string;
    postcode?: string;
  };
};

function parseCoordinate(value: unknown) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) {
    return null;
  }

  const coordinate = Number(value);
  return Number.isFinite(coordinate) ? coordinate : null;
}

function parseSenderLocations(value: unknown): SenderLocation[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((row: unknown) => {
    if (!row || typeof row !== 'object') return [];

    const record = row as Record<string, unknown>;
    const id = record.id === undefined || record.id === null ? '' : String(record.id);
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    const latitude = parseCoordinate(record.latitude);
    const longitude = parseCoordinate(record.longitude);

    if (
      !id ||
      !name ||
      latitude === null ||
      latitude < -90 ||
      latitude > 90 ||
      longitude === null ||
      longitude < -180 ||
      longitude > 180
    ) {
      return [];
    }

    return [{ id, name, latitude, longitude }];
  });
}

function getSuggestionLabel(feature: PhotonFeature) {
  const { name, housenumber, street, district, city, state, postcode, country } = feature.properties;
  const streetAddress = [housenumber, street].filter(Boolean).join(' ');

  return [...new Set([name, streetAddress, district, city, state, postcode, country].filter(Boolean))]
    .join(', ');
}

export default function DeliveryMapScreen() {
  const { isDark } = useAppTheme();
  const styles = useThemeStyles(baseStyles);
  const { senderId } = useLocalSearchParams<{ senderId?: string }>();
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchAbortController = useRef<AbortController | null>(null);
  const routeRequestId = useRef(0);
  const [userLocation, setUserLocation] = useState<MapCoordinate | null>(null);
  const [locationError, setLocationError] = useState('');
  const [senderLocations, setSenderLocations] = useState<SenderLocation[]>([]);
  const [focusedSender, setFocusedSender] = useState<SenderLocation | null>(null);
  const [sendersLoading, setSendersLoading] = useState(true);
  const [sendersError, setSendersError] = useState<string | null>(null);

  // ပါဆယ်ပို့ရမည့် နေရာ
  const [destination, setDestination] = useState<MapCoordinate | null>(null);
  const [destinationName, setDestinationName] = useState<string | null>(null);
  const [focusLocation, setFocusLocation] = useState<MapCoordinate | null>(null);
  const [focusVersion, setFocusVersion] = useState(0);
  const [focusZoom, setFocusZoom] = useState(16);

  // Search States
  const [searchMode, setSearchMode] = useState<SearchMode>('senders');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<PhotonFeature[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Card Hide/Show State
  const [isCardVisible, setIsCardVisible] = useState(true);

  // Route Coordinates for Polyline
  const [routeCoords, setRouteCoords] = useState<MapCoordinate[]>([]);

  useEffect(() => {
    let isActive = true;

    const loadSenderLocations = async () => {
      try {
        const { data, error } = await supabase
          .from('senders')
          .select('id, name, latitude, longitude');
        if (error) throw error;

        if (isActive) {
          const parsedSenders = parseSenderLocations(data);
          setSenderLocations(parsedSenders);
          setSendersError(null);
          if (senderId) {
            const sender = parsedSenders.find((item) => item.id === senderId);
            if (sender) {
              setFocusedSender(sender);
              setFocusLocation(sender);
              setFocusVersion((version) => version + 1);
              setFocusZoom(17);
              setSearchQuery('');
            } else {
              setSendersError('ရွေးထားသော ပို့သူ၏ တည်နေရာကို ရှာမတွေ့ပါ။');
            }
          }
        }
      } catch (error) {
        console.error('Sender locations error:', error);
        if (isActive) {
          setSenderLocations([]);
          setSendersError('ပို့သူတည်နေရာများကို ရယူ၍မရပါ။ ထပ်မံကြိုးစားပါ။');
        }
      } finally {
        if (isActive) setSendersLoading(false);
      }
    };

    void loadSenderLocations();
    return () => {
      isActive = false;
    };
  }, [senderId]);

  const requestUserLocation = useCallback(async () => {
    setLocationError('');
    try {
      if (Platform.OS === 'web') {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (!permission.granted) {
          setLocationError('Map အသုံးပြုရန် browser တွင် Location ခွင့်ပြုချက်ပေးပါ။');
          return;
        }
      }

      const initialLoc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const initialCoords = {
        latitude: initialLoc.coords.latitude,
        longitude: initialLoc.coords.longitude,
      };

      setUserLocation(initialCoords);

      locationSubscriptionRef.current?.remove();
      locationSubscriptionRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 3000,
          distanceInterval: 5,
        },
        (newLocation) => {
          setUserLocation({
            latitude: newLocation.coords.latitude,
            longitude: newLocation.coords.longitude,
          });
        }
      );
    } catch (error) {
      console.error('Could not read the rider location for the map.', error);
      setLocationError(
        error instanceof Error ? error.message : 'တည်နေရာ ရယူ၍မရပါ။ Permission ကိုစစ်ဆေးပါ။',
      );
    }
  }, []);

  const locationSubscriptionRef = useRef<Location.LocationSubscription | null>(null);

  useEffect(() => {
    let isActive = true;
    queueMicrotask(() => {
      if (isActive) void requestUserLocation();
    });

    return () => {
      isActive = false;
      locationSubscriptionRef.current?.remove();
      locationSubscriptionRef.current = null;
    };
  }, [requestUserLocation]);

  useEffect(
    () => () => {
      if (searchTimeout.current) {
        clearTimeout(searchTimeout.current);
      }
      searchAbortController.current?.abort();
      searchAbortController.current = null;
    },
    []
  );

  // OSRM API ဖြင့် လမ်းကြောင်း ဆွဲခြင်း
  const fetchRoute = async (
    start: { latitude: number; longitude: number },
    end: { latitude: number; longitude: number }
  ) => {
    const requestId = ++routeRequestId.current;
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${start.longitude},${start.latitude};${end.longitude},${end.latitude}?overview=full&geometries=geojson`;
      const response = await fetch(url);
      const data = await response.json();

      if (requestId === routeRequestId.current && data.routes && data.routes.length > 0) {
        const points = data.routes[0].geometry.coordinates.map((coord: [number, number]) => ({
          latitude: coord[1],
          longitude: coord[0],
        }));
        setRouteCoords(points);
      }
    } catch (error) {
      if (requestId === routeRequestId.current) {
        console.error('Route error:', error);
      }
    }
  };

  // Map ပေါ်တွင် Tap လုပ်သည့်အခါ
  const handleMapPress = (coords: MapCoordinate) => {
    if (!isCardVisible) return;

    setDestination(coords);
    setDestinationName(null);
    setFocusedSender(null);
    setSearchResults([]);
    setSearchError(null);
    if (searchTimeout.current) {
      clearTimeout(searchTimeout.current);
      searchTimeout.current = null;
    }
    searchAbortController.current?.abort();
    searchAbortController.current = null;
    setIsSearching(false);

    if (userLocation) {
      fetchRoute(userLocation, coords);
    }
  };

  const focusMapAt = (coords: MapCoordinate, zoom = 16) => {
    setFocusLocation(coords);
    setFocusVersion((version) => version + 1);
    setFocusZoom(zoom);
  };

  // Search Action
  const fetchSuggestions = async (query: string) => {
    searchAbortController.current?.abort();
    const controller = new AbortController();
    searchAbortController.current = controller;
    setIsSearching(true);

    try {
      const response = await fetch(
        `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=6`,
        { signal: controller.signal }
      );
      if (!response.ok) {
        throw new Error(`Place search failed with status ${response.status}`);
      }

      const data: { features?: PhotonFeature[] } = await response.json();
      if (searchAbortController.current === controller) {
        setSearchResults(Array.isArray(data.features) ? data.features : []);
        setSearchError(null);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      console.error('Place search error:', error);
      if (searchAbortController.current === controller) {
        setSearchResults([]);
        setSearchError('နေရာရှာဖွေ၍ မရပါ။ ထပ်မံကြိုးစားပါ။');
      }
    } finally {
      if (searchAbortController.current === controller) {
        searchAbortController.current = null;
        setIsSearching(false);
      }
    }
  };

  const handleSearchQueryChange = (query: string) => {
    setSearchQuery(query);
    setSearchResults([]);
    setSearchError(null);

    if (searchTimeout.current) {
      clearTimeout(searchTimeout.current);
      searchTimeout.current = null;
    }
    searchAbortController.current?.abort();
    searchAbortController.current = null;
    setIsSearching(false);

    const trimmedQuery = query.trim();
    if (searchMode !== 'places' || trimmedQuery.length < 2) return;

    searchTimeout.current = setTimeout(() => {
      searchTimeout.current = null;
      void fetchSuggestions(trimmedQuery);
    }, 400);
  };

  const handleSearch = () => {
    if (searchMode !== 'places') return;

    const query = searchQuery.trim();
    if (query.length < 2) return;

    if (searchTimeout.current) {
      clearTimeout(searchTimeout.current);
      searchTimeout.current = null;
    }
    void fetchSuggestions(query);
  };

  const handleSearchSendersMode = () => {
    setSearchMode('senders');
    setSearchResults([]);
    setSearchError(null);
    if (searchTimeout.current) {
      clearTimeout(searchTimeout.current);
      searchTimeout.current = null;
    }
    searchAbortController.current?.abort();
    searchAbortController.current = null;
    setIsSearching(false);
  };

  const handleSearchPlacesMode = () => {
    setSearchMode('places');
    setSearchResults([]);
    setSearchError(null);
    if (searchTimeout.current) {
      clearTimeout(searchTimeout.current);
      searchTimeout.current = null;
    }
    searchAbortController.current?.abort();
    searchAbortController.current = null;
    setIsSearching(false);

    const query = searchQuery.trim();
    if (query.length >= 2) {
      void fetchSuggestions(query);
    }
  };

  const senderSearchResults = searchQuery.trim()
    ? senderLocations.filter((sender) =>
        sender.name.toLocaleLowerCase().includes(searchQuery.trim().toLocaleLowerCase())
      )
    : [];

  const handleSelectSender = (sender: SenderLocation) => {
    setFocusedSender(sender);
    focusMapAt(sender, 17);
    setSearchQuery('');
  };

  const handleChooseSenderAsDestination = (sender: SenderLocation) => {
    setDestination(sender);
    setDestinationName(sender.name);
    setFocusedSender(sender);
    setSearchQuery('');
    setIsCardVisible(true);
    focusMapAt(sender, 17);

    if (userLocation) {
      fetchRoute(userLocation, sender);
    }
  };

  // Search Result ရွေးချယ်သည့်အခါ
  const handleSelectSearchResult = (item: PhotonFeature) => {
    const [lon, lat] = item.geometry.coordinates;
    const newDest = { latitude: lat, longitude: lon };

    setDestination(newDest);
    setDestinationName(
      getSuggestionLabel(item) || `${newDest.latitude.toFixed(5)}, ${newDest.longitude.toFixed(5)}`
    );
    setFocusedSender(null);
    setSearchResults([]);
    setSearchError(null);
    setSearchQuery('');
    setIsCardVisible(true);

    focusMapAt(newDest);

    if (userLocation) {
      fetchRoute(userLocation, newDest);
    }
  };

  const handleRemovePin = () => {
    routeRequestId.current += 1;
    setDestination(null);
    setDestinationName(null);
    setRouteCoords([]);
  };

  const handleRecenterUser = () => {
    if (userLocation) {
      focusMapAt(userLocation);
    }
  };

  if (locationError && !userLocation) {
    return React.createElement(
      View,
      { style: styles.locationPermissionContainer },
      React.createElement(Ionicons, { name: 'location-outline', size: 42, color: '#f97316' }),
      React.createElement(Text, { style: styles.locationPermissionText }, locationError),
      React.createElement(
        TouchableOpacity,
        {
          style: styles.locationRetryButton,
          onPress: () => void requestUserLocation(),
          accessibilityRole: 'button',
        },
        React.createElement(Text, { style: styles.locationRetryText }, 'ထပ်ကြိုးစားမည်'),
      ),
    );
  }

  return React.createElement(
    View,
    { style: styles.container },

    // Full Screen Map View
    React.createElement(
      View,
      { style: styles.mapLayer },
      React.createElement(LeafletMap, {
        initialCenter: userLocation ?? { latitude: 16.8409, longitude: 96.1735 },
        userLocation,
        senderLocations,
        focusedSender,
        destination,
        routeCoords,
        focusLocation,
        focusVersion,
        focusZoom,
        onMapPress: handleMapPress,
      })
    ),

    // Overlays Wrapper in SafeAreaView
    React.createElement(
      SafeAreaView,
      { style: styles.overlaySafeArea, pointerEvents: 'box-none' },

      // Search Bar Header
      React.createElement(
        View,
        { style: styles.searchHeaderContainer },
        React.createElement(
          View,
          { style: styles.searchBar },
          React.createElement(
            TouchableOpacity,
            { onPress: () => router.back(), style: styles.iconBtn },
            React.createElement(Ionicons, { name: 'arrow-back', size: 22, color: isDark ? '#f1f5f9' : '#0f172a' })
          ),
          React.createElement(TextInput, {
            style: styles.searchInput,
            placeholder:
              searchMode === 'senders'
                ? 'ပို့သူအမည် ရှာမည်...'
                : 'နေရာ သို့မဟုတ် လမ်းအမည် ရှာမည်...',
            placeholderTextColor: '#94a3b8',
            value: searchQuery,
            onChangeText: handleSearchQueryChange,
            returnKeyType: 'search',
            onSubmitEditing: searchMode === 'places' ? handleSearch : undefined,
          }),
          searchMode === 'places'
            ? isSearching
              ? React.createElement(ActivityIndicator, { size: 'small', color: '#f97316' })
              : React.createElement(
                  TouchableOpacity,
                  {
                    onPress: handleSearch,
                    style: styles.iconBtn,
                    accessibilityRole: 'button',
                    accessibilityLabel: 'မြေပုံနေရာ ရှာဖွေမည်',
                  },
                  React.createElement(Ionicons, { name: 'search', size: 22, color: '#f97316' })
                )
            : null
        ),
        React.createElement(
          View,
          { style: styles.searchModeSwitch },
          React.createElement(
            TouchableOpacity,
            {
              style: [styles.searchModeButton, searchMode === 'senders' && styles.searchModeButtonActive],
              onPress: handleSearchSendersMode,
              accessibilityRole: 'button',
              accessibilityLabel: 'ပို့သူများ',
              accessibilityState: { selected: searchMode === 'senders' },
            },
            React.createElement(Ionicons, {
              name: 'business-outline',
              size: 17,
              color: searchMode === 'senders' ? '#ffffff' : '#475569',
            })
          ),
          React.createElement(
            TouchableOpacity,
            {
              style: [styles.searchModeButton, searchMode === 'places' && styles.searchModeButtonActive],
              onPress: handleSearchPlacesMode,
              accessibilityRole: 'button',
              accessibilityLabel: 'မြေပုံနေရာများ',
              accessibilityState: { selected: searchMode === 'places' },
            },
            React.createElement(Ionicons, {
              name: 'map-outline',
              size: 17,
              color: searchMode === 'places' ? '#ffffff' : '#475569',
            })
          )
        ),
        searchMode === 'senders' && sendersError
          ? React.createElement(
              View,
              { style: styles.searchResultsList },
              React.createElement(Text, { style: styles.searchErrorText }, sendersError)
            )
          : null,
        searchMode === 'senders' && sendersLoading && searchQuery.trim()
          ? React.createElement(
              View,
              { style: styles.searchResultsList },
              React.createElement(PageLoadingSkeleton, {
                isDark,
                variant: 'search',
                count: 2,
                inline: true,
              })
            )
          : null,
        searchMode === 'senders' && !sendersLoading && !sendersError && searchQuery.trim()
          ? senderSearchResults.length > 0
            ? React.createElement(FlatList<SenderLocation>, {
                data: senderSearchResults,
                keyExtractor: (item, index) =>
                  `${item.name}-${item.latitude}-${item.longitude}-${index}`,
                style: styles.searchResultsList,
                keyboardShouldPersistTaps: 'handled',
                nestedScrollEnabled: true,
                renderItem: ({ item }: { item: SenderLocation }) =>
                  React.createElement(
                    View,
                    { style: styles.searchResultItem },
                    React.createElement(Ionicons, { name: 'business-outline', size: 18, color: '#16a34a' }),
                    React.createElement(
                      View,
                      { style: styles.senderSearchResult },
                      React.createElement(
                        TouchableOpacity,
                        {
                          onPress: () => handleSelectSender(item),
                          accessibilityRole: 'button',
                          accessibilityLabel: `${item.name} ကို မြေပုံပေါ်တွင်ပြမည်`,
                        },
                        React.createElement(
                          Text,
                          { style: styles.searchResultText, numberOfLines: 1 },
                          item.name
                        ),
                        React.createElement(
                          Text,
                          { style: styles.senderCoordinates, numberOfLines: 1 },
                          `${item.latitude.toFixed(5)}, ${item.longitude.toFixed(5)}`
                        )
                      ),
                    ),
                    React.createElement(
                      TouchableOpacity,
                      {
                        style: styles.chooseSenderButton,
                        onPress: () => handleChooseSenderAsDestination(item),
                        accessibilityRole: 'button',
                        accessibilityLabel: `${item.name} ကို ရွေးချယ်ထားသောနေရာအဖြစ် သတ်မှတ်မည်`,
                      },
                      React.createElement(Ionicons, { name: 'checkmark-circle-outline', size: 16, color: '#ffffff' }),
                      React.createElement(
                        Text,
                        { style: styles.chooseSenderButtonText },
                        'ရွေးမည်'
                      )
                    )
                  ),
              })
            : React.createElement(
                View,
                { style: styles.searchResultsList },
                React.createElement(Text, { style: styles.searchEmptyText }, 'ပို့သူအမည် မတွေ့ပါ')
              )
          : null,
        searchMode === 'places' && searchResults.length > 0
          ? React.createElement(FlatList<PhotonFeature>, {
              data: searchResults,
              keyExtractor: (item) =>
                `${item.properties.osm_type ?? 'place'}-${item.properties.osm_id ?? item.geometry.coordinates.join(',')}`,
              style: styles.searchResultsList,
              keyboardShouldPersistTaps: 'handled',
              nestedScrollEnabled: true,
              ListFooterComponent: React.createElement(
                Text,
                { style: styles.searchAttribution },
                '© OpenStreetMap contributors · Photon'
              ),
              renderItem: ({ item }: { item: PhotonFeature }) =>
                React.createElement(
                  TouchableOpacity,
                  {
                    style: styles.searchResultItem,
                    onPress: () => handleSelectSearchResult(item),
                  },
                  React.createElement(Ionicons, { name: 'location-outline', size: 18, color: '#64748b' }),
                  React.createElement(
                    Text,
                    { style: styles.searchResultText, numberOfLines: 2 },
                    getSuggestionLabel(item)
                  )
                ),
            })
          : searchMode === 'places' && searchQuery.trim().length >= 2 && !isSearching
            ? React.createElement(
                View,
                { style: styles.searchResultsList },
                React.createElement(
                  Text,
                  { style: searchError ? styles.searchErrorText : styles.searchEmptyText },
                  searchError ?? 'ရှာဖွေမှုရလဒ် မတွေ့ပါ'
                )
              )
          : null
      ),

      // Recenter Location Button
      React.createElement(
        TouchableOpacity,
        {
          style: [
            styles.myLocationBtn,
            { bottom: isCardVisible && destination ? 170 : 160 },
          ],
          onPress: handleRecenterUser,
        },
        React.createElement(Ionicons, { name: 'locate', size: 24, color: '#f97316' })
      ),

      // Re-open location selection pill
      !isCardVisible
        ? React.createElement(
            TouchableOpacity,
            {
              style: styles.reopenCardBtn,
              onPress: () => setIsCardVisible(true),
              accessibilityRole: 'button',
              accessibilityLabel: 'တည်နေရာရွေးချယ်ရန် ဖွင့်မည်',
            },
            React.createElement(Ionicons, { name: 'location-outline', size: 18, color: '#ffffff' }),
            React.createElement(Text, { style: styles.reopenCardText }, 'နေရာရွေးရန်')
          )
        : null,

      // Bottom Info Card
      isCardVisible
        ? React.createElement(
            View,
            { style: styles.bottomCard },
            React.createElement(Ionicons, { name: 'location', size: 20, color: '#f97316' }),
            React.createElement(
              View,
              { style: styles.cardDetails },
              React.createElement(
                Text,
                { style: styles.infoTitle, numberOfLines: 1 },
                destination ? 'ရွေးချယ်ထားသော တည်နေရာ' : 'နေရာရွေးရန် မြေပုံကိုထောက်ပါ'
              ),
              destination
                ? React.createElement(
                    Text,
                    { style: styles.infoSubtitle, numberOfLines: 1 },
                    destinationName ?? `${destination.latitude.toFixed(5)}, ${destination.longitude.toFixed(5)}`
                  )
                : null
            ),
            destination
              ? React.createElement(
                TouchableOpacity,
                {
                  style: styles.removePinButton,
                  onPress: handleRemovePin,
                  accessibilityRole: 'button',
                  accessibilityLabel: 'ရွေးချယ်ထားသော pin ကိုဖြုတ်မည်',
                  hitSlop: 8,
                },
                React.createElement(Ionicons, { name: 'close-circle-outline', size: 22, color: '#dc2626' })
              )
              : null,
            React.createElement(
              TouchableOpacity,
              {
                onPress: () => setIsCardVisible(false),
                style: styles.hideBtn,
                accessibilityRole: 'button',
                accessibilityLabel: 'တည်နေရာကတ်ကိုပိတ်မည်',
                hitSlop: 8,
              },
              React.createElement(Ionicons, { name: 'chevron-down', size: 20, color: '#64748b' })
            )
          )
        : null
    )
  );
}

const baseStyles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    position: 'relative',
    backgroundColor: '#f8fafc',
  },
  mapLayer: {
    ...StyleSheet.absoluteFill,
  },
  overlaySafeArea: {
    ...StyleSheet.absoluteFill,
    zIndex: 10,
    elevation: 10,
  },
  locationPermissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    backgroundColor: '#f8fafc',
  },
  locationPermissionText: {
    marginTop: 16,
    color: '#334155',
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
  },
  locationRetryButton: {
    marginTop: 20,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#f97316',
  },
  locationRetryText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },

  // Search Header
  searchHeaderContainer: {
    position: 'absolute',
    top: Platform.OS === 'android' ? 40 : 50,
    left: 16,
    right: 16,
    zIndex: 20,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 30,
    paddingHorizontal: 12,
    paddingVertical: 8,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
  },
  searchModeSwitch: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    marginTop: 6,
    padding: 2,
    borderRadius: 15,
    backgroundColor: '#ffffff',
    elevation: 4,
  },
  searchModeButton: {
    width: 32,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
  },
  searchModeButtonActive: {
    backgroundColor: '#f97316',
  },
  iconBtn: { padding: 4 },
  searchInput: {
    flex: 1,
    marginHorizontal: 8,
    fontSize: 14,
    color: '#0f172a',
  },
  searchResultsList: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    marginTop: 6,
    maxHeight: 200,
    elevation: 5,
  },
  searchResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderBottomWidth: 1,
    borderColor: '#f1f5f9',
  },
  searchResultText: { fontSize: 13, color: '#334155', flex: 1 },
  senderSearchResult: { flex: 1 },
  senderCoordinates: { marginTop: 2, fontSize: 11, color: '#64748b' },
  chooseSenderButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#16a34a',
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderRadius: 16,
  },
  chooseSenderButtonText: { color: '#ffffff', fontSize: 11, fontWeight: '700' },
  searchAttribution: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#64748b',
    fontSize: 10,
    textAlign: 'right',
  },
  searchEmptyText: {
    padding: 14,
    color: '#64748b',
    fontSize: 13,
  },
  searchErrorText: {
    padding: 14,
    color: '#b91c1c',
    fontSize: 13,
  },

  // My Location Button
  myLocationBtn: {
    position: 'absolute',
    right: 16,
    backgroundColor: '#ffffff',
    padding: 12,
    borderRadius: 30,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },

  // Re-open Card Button
  reopenCardBtn: {
    position: 'absolute',
    right: 16,
    bottom: 100,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#0f172a',
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 24,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  reopenCardText: { color: '#ffffff', fontWeight: '600', fontSize: 13 },

  // Bottom Card
  bottomCard: {
    position: 'absolute',
    bottom: 100,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 28,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  cardDetails: { flex: 1, minWidth: 0 },
  hideBtn: { padding: 4 },
  infoTitle: { fontSize: 13, fontWeight: '700', color: '#0f172a' },
  infoSubtitle: { fontSize: 11, color: '#64748b', marginTop: 2 },
  removePinButton: { padding: 4 },
});