  import { supabase } from '@/lib/supabase';
  import AsyncStorage from '@react-native-async-storage/async-storage';
  import NetInfo from '@react-native-community/netinfo';
  import type { RealtimeChannel } from '@supabase/supabase-js';
  import { isRunningInExpoGo } from 'expo';
  import * as Location from 'expo-location';
  import * as TaskManager from 'expo-task-manager';
  import { AppState, Platform } from 'react-native';

  const CHANNEL_NAME = 'online-riders-stream';
  const EVENT_NAME = 'rider-pos';
  const LOCATION_TASK_NAME = 'rider-background-location';
  const RIDER_ID_STORAGE_KEY = 'rider-location-broadcast-id';
  const PENDING_LOCATION_STORAGE_KEY = 'rider-location-pending-db-sync';
  const LOCATION_STALE_AFTER_MS = 60_000;
  const HEARTBEAT_INTERVAL_MS = 15_000;
  const LOCATION_RETRY_INTERVAL_MS = 15_000;
  const DB_SYNC_INTERVAL_MS = 5 * 60 * 1000;
  const DB_RETRY_INTERVAL_MS = 60_000;
  const supportsBackgroundLocation = Platform.OS !== 'web' && !isRunningInExpoGo();

  type RiderPosition = {
    rider_id: string;
    latitude: number;
    longitude: number;
    timestamp: number;
  };

  export type LocationBroadcastStatus = {
    state: 'idle' | 'starting' | 'waiting' | 'sending' | 'broadcasting' | 'error';
    isRunning: boolean;
    lastSentAt: number | null;
    lastPosition: { latitude: number; longitude: number } | null;
    error: string | null;
  };

  const statusListeners = new Set<(status: LocationBroadcastStatus) => void>();
  let broadcastStatus: LocationBroadcastStatus = {
    state: 'idle',
    isRunning: false,
    lastSentAt: null,
    lastPosition: null,
    error: null,
  };

  let channel: RealtimeChannel | null = null;
  let channelPromise: Promise<RealtimeChannel> | null = null;
  let foregroundLocationSubscription: Location.LocationSubscription | null = null;
  let activeRiderId: string | null = null;
  let latestPosition: RiderPosition | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let recoveryTimer: ReturnType<typeof setInterval> | null = null;
  let recoveryInFlight = false;
  let generation = 0;
  let stopping = false;
  let pendingStart: { riderId: string; promise: Promise<void> } | null = null;
  let lastDBSyncTime = 0;
  let lastDBSyncAttemptTime = 0;
  let databaseSyncRunning = false;
  let queuedDBSync: { position: RiderPosition; forceSync: boolean } | null = null;
  let databaseSyncWaiters: (() => void)[] = [];
  let pendingLocationSyncInFlight = false;
  let pendingDBSyncFailed = false;
  let pendingLocationRetryTimer: ReturnType<typeof setInterval> | null = null;
  let locationTaskStopPromise: Promise<void> | null = null;
  let lastStaleLocationRecoveryAt = 0;
  let wasOffline = false;

  function parseStoredPosition(value: string | null): RiderPosition | null {
    if (!value) return null;

    try {
      const parsed: unknown = JSON.parse(value);
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        !('rider_id' in parsed) ||
        typeof parsed.rider_id !== 'string' ||
        !('latitude' in parsed) ||
        typeof parsed.latitude !== 'number' ||
        !Number.isFinite(parsed.latitude) ||
        !('longitude' in parsed) ||
        typeof parsed.longitude !== 'number' ||
        !Number.isFinite(parsed.longitude) ||
        !('timestamp' in parsed) ||
        typeof parsed.timestamp !== 'number' ||
        !Number.isFinite(parsed.timestamp)
      ) {
        return null;
      }

      return {
        rider_id: parsed.rider_id,
        latitude: parsed.latitude,
        longitude: parsed.longitude,
        timestamp: parsed.timestamp,
      };
    } catch {
      return null;
    }
  }

  function isLocationFresh(position: RiderPosition | null): boolean {
    if (!position) return false;
    const age = Date.now() - position.timestamp;
    return age >= 0 && age < LOCATION_STALE_AFTER_MS;
  }

  async function storePendingLocation(position: RiderPosition): Promise<void> {
    try {
      await AsyncStorage.setItem(PENDING_LOCATION_STORAGE_KEY, JSON.stringify(position));
    } catch (error) {
      console.error('Could not preserve the latest location for a database retry.', error);
    }
  }

  async function clearSyncedPendingLocation(position: RiderPosition): Promise<void> {
    try {
      const pending = parseStoredPosition(await AsyncStorage.getItem(PENDING_LOCATION_STORAGE_KEY));
      if (pending?.rider_id === position.rider_id && pending.timestamp <= position.timestamp) {
        await AsyncStorage.removeItem(PENDING_LOCATION_STORAGE_KEY);
      }
    } catch (error) {
      console.error('Could not clear the saved location after database sync.', error);
    }
  }

  function schedulePendingLocationRetry(): void {
    if (pendingLocationRetryTimer) return;

    pendingLocationRetryTimer = setInterval(() => {
      void flushPendingLocationSync();
    }, DB_RETRY_INTERVAL_MS);
  }

  async function flushPendingLocationSync(): Promise<void> {
    if (pendingLocationSyncInFlight || (activeRiderId && !pendingDBSyncFailed)) return;

    pendingLocationSyncInFlight = true;
    try {
      const position = parseStoredPosition(
        await AsyncStorage.getItem(PENDING_LOCATION_STORAGE_KEY),
      );
      if (position) {
        await syncToDatabaseSmart(position, true);
        const remaining = parseStoredPosition(
          await AsyncStorage.getItem(PENDING_LOCATION_STORAGE_KEY),
        );
        if (!remaining && pendingLocationRetryTimer) {
          clearInterval(pendingLocationRetryTimer);
          pendingLocationRetryTimer = null;
        } else if (remaining) {
          schedulePendingLocationRetry();
        }
      } else if (pendingLocationRetryTimer) {
        clearInterval(pendingLocationRetryTimer);
        pendingLocationRetryTimer = null;
      }
    } catch (error) {
      console.error('Could not retry syncing the saved rider location.', error);
      schedulePendingLocationRetry();
    } finally {
      pendingLocationSyncInFlight = false;
    }
  }

  async function syncToDatabaseSmart(
    position: RiderPosition,
    forceSync = false,
  ): Promise<void> {
    queuedDBSync = {
      position,
      forceSync: forceSync || queuedDBSync?.forceSync === true,
    };

    if (databaseSyncRunning) {
      return new Promise((resolve) => databaseSyncWaiters.push(resolve));
    }

    databaseSyncRunning = true;
    const syncLoop = async () => {
      try {
        while (queuedDBSync) {
          const nextSync = queuedDBSync;
          queuedDBSync = null;
          const now = Date.now();
          if (
            !nextSync.forceSync &&
            (now - lastDBSyncTime < DB_SYNC_INTERVAL_MS ||
              now - lastDBSyncAttemptTime < DB_RETRY_INTERVAL_MS)
          ) {
            continue;
          }

          lastDBSyncAttemptTime = now;
          const { error, data } = await supabase
            .from('riders')
            .update({
              last_latitude: nextSync.position.latitude,
              last_longitude: nextSync.position.longitude,
              last_seen_at: new Date(nextSync.position.timestamp).toISOString(),
            })
            .eq('id', nextSync.position.rider_id)
            .select('id')
            .maybeSingle();

          if (error) throw error;
          if (!data) throw new Error('Rider record was not found while saving location.');
          lastDBSyncTime = Date.now();
          pendingDBSyncFailed = false;
          await clearSyncedPendingLocation(nextSync.position);
        }
      } catch (error) {
        pendingDBSyncFailed = true;
        console.error('Failed to sync latest rider location to the database:', error);
        schedulePendingLocationRetry();
      } finally {
        databaseSyncRunning = false;
        if (queuedDBSync) {
          const nextSync = queuedDBSync;
          queuedDBSync = null;
          await syncToDatabaseSmart(nextSync.position, nextSync.forceSync);
        }
        const waiters = databaseSyncWaiters;
        databaseSyncWaiters = [];
        for (const resolve of waiters) resolve();
      }
    };

    return syncLoop();
  }

  function updateBroadcastStatus(status: Partial<LocationBroadcastStatus>): void {
    broadcastStatus = { ...broadcastStatus, ...status };
    for (const listener of statusListeners) {
      listener(broadcastStatus);
    }
  }

  export function subscribeToLocationBroadcastStatus(
    listener: (status: LocationBroadcastStatus) => void
  ): () => void {
    statusListeners.add(listener);
    listener(broadcastStatus);
    return () => {
      statusListeners.delete(listener);
    };
  }

  export async function loadLastKnownLocation(
    riderId: string,
  ): Promise<{ latitude: number; longitude: number; timestamp: number } | null> {
    let pendingPosition: RiderPosition | null = null;
    try {
      pendingPosition = parseStoredPosition(
        await AsyncStorage.getItem(PENDING_LOCATION_STORAGE_KEY),
      );
    } catch (error) {
      console.error('Could not load a locally saved rider location.', error);
    }
    const localPosition = pendingPosition?.rider_id === riderId ? pendingPosition : null;

    try {
      const { data, error } = await supabase
        .from('riders')
        .select('last_latitude, last_longitude, last_seen_at')
        .eq('id', riderId)
        .maybeSingle();

      if (error) throw error;
      if (
        !data ||
        typeof data.last_latitude !== 'number' ||
        typeof data.last_longitude !== 'number' ||
        typeof data.last_seen_at !== 'string'
      ) {
        return localPosition;
      }

      const timestamp = Date.parse(data.last_seen_at);
      if (!Number.isFinite(timestamp)) return localPosition;
      if (localPosition && localPosition.timestamp > timestamp) {
        return {
          latitude: localPosition.latitude,
          longitude: localPosition.longitude,
          timestamp: localPosition.timestamp,
        };
      }

      return {
        latitude: data.last_latitude,
        longitude: data.last_longitude,
        timestamp,
      };
    } catch (error) {
      console.error('Could not load the last saved rider location from the database.', error);
      if (localPosition) {
        return {
          latitude: localPosition.latitude,
          longitude: localPosition.longitude,
          timestamp: localPosition.timestamp,
        };
      }
      throw error;
    }
  }

  function subscribeToChannel(
    realtimeChannel: RealtimeChannel,
    onFailure: (error: Error) => void,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let isSubscribed = false;
      realtimeChannel.subscribe((status, error) => {
        if (status === 'SUBSCRIBED') {
          isSubscribed = true;
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          const failure = error ?? new Error(`Realtime channel subscription failed: ${status}`);
          if (isSubscribed) {
            onFailure(failure);
          } else {
            reject(failure);
          }
        }
      });
    });
  }

  async function getBroadcastChannel(): Promise<RealtimeChannel> {
    if (channelPromise) return channelPromise;
    if (channel) return channel;

    const realtimeChannel = supabase.channel(CHANNEL_NAME);
    channel = realtimeChannel;
    const subscriptionPromise = subscribeToChannel(realtimeChannel, (error) => {
      if (stopping || channel !== realtimeChannel) return;
      console.error('Location Realtime channel disconnected.', error);
      updateBroadcastStatus({
        state: 'error',
        isRunning: true,
        error: error.message,
      });
      startRecoveryMonitor();
      void discardBroadcastChannel(realtimeChannel);
    })
      .then(() => realtimeChannel)
      .catch(async (error: unknown) => {
        if (channel === realtimeChannel) channel = null;
        try {
          const result = await supabase.removeChannel(realtimeChannel);
          if (result !== 'ok') {
            console.error(`Could not remove failed location channel: ${result}`);
          }
        } catch (removeError) {
          console.error('Could not clean up the failed location channel.', removeError);
        }
        throw error;
      })
      .finally(() => {
        if (channelPromise === subscriptionPromise) channelPromise = null;
      });

    channelPromise = subscriptionPromise;
    return subscriptionPromise;
  }

  async function broadcastPosition(
    position: RiderPosition,
    operation?: number
  ): Promise<void> {
    if (operation !== undefined && operation !== generation) return;

    updateBroadcastStatus({ state: 'sending', error: null });
    let sendingChannel: RealtimeChannel | null = null;

    try {
      const realtimeChannel = await getBroadcastChannel();
      sendingChannel = realtimeChannel;
      if (operation !== undefined && operation !== generation) return;

      const result = await realtimeChannel.send({
        type: 'broadcast',
        event: EVENT_NAME,
        payload: position,
      });

      if (operation !== undefined && operation !== generation) return;

      if (result !== 'ok') {
        console.error(`Location broadcast failed: ${result}`);
        await discardBroadcastChannel(realtimeChannel);
        updateBroadcastStatus({
          state: 'error',
          isRunning: true,
          error: `Supabase Realtime returned ${result}.`,
        });
        return;
      }

      updateBroadcastStatus({
        state: 'broadcasting',
        isRunning: true,
        lastSentAt: position.timestamp,
        lastPosition: {
          latitude: position.latitude,
          longitude: position.longitude,
        },
        error: null,
      });
    } catch (error) {
      if (operation !== undefined && operation !== generation) return;

      console.error('Location broadcast failed.', error);
      if (sendingChannel) await discardBroadcastChannel(sendingChannel);
      updateBroadcastStatus({
        state: 'error',
        isRunning: true,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function discardBroadcastChannel(failedChannel?: RealtimeChannel): Promise<void> {
    const staleChannel = failedChannel ?? channel;
    if (!staleChannel) return;

    if (channel === staleChannel) channel = null;
    if (channelPromise) channelPromise = null;

    try {
      const result = await supabase.removeChannel(staleChannel);
      if (result !== 'ok') {
        console.error(`Could not remove failed location channel: ${result}`);
      }
    } catch (error) {
      console.error('Could not clean up the failed location channel.', error);
    }
  }

  function startHeartbeat(operation: number): void {
    if (heartbeatTimer) clearInterval(heartbeatTimer);

    heartbeatTimer = setInterval(() => {
      if (operation !== generation || !latestPosition) return;

      if (!isLocationFresh(latestPosition)) {
        updateBroadcastStatus({ state: 'waiting', isRunning: true });
        return;
      }

      void broadcastPosition(latestPosition, operation);
    }, HEARTBEAT_INTERVAL_MS);
  }

  function startRecoveryMonitor(): void {
    if (recoveryTimer) return;

    recoveryTimer = setInterval(() => {
      void recoverLocationBroadcast();
    }, LOCATION_RETRY_INTERVAL_MS);
  }

  async function stopLocationTaskIfRunning(): Promise<void> {
    foregroundLocationSubscription?.remove();
    foregroundLocationSubscription = null;

    if (!supportsBackgroundLocation) return;
    if (locationTaskStopPromise) return locationTaskStopPromise;

    const stopPromise = (async () => {
      const taskIsRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
      if (taskIsRunning) {
        await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
      }
    })();
    locationTaskStopPromise = stopPromise;

    try {
      await stopPromise;
    } finally {
      if (locationTaskStopPromise === stopPromise) {
        locationTaskStopPromise = null;
      }
    }
  }

  async function recoverLocationBroadcast(): Promise<void> {
    if (stopping || recoveryInFlight || pendingStart) return;

    recoveryInFlight = true;
    try {
      const riderId = activeRiderId ?? await AsyncStorage.getItem(RIDER_ID_STORAGE_KEY);
      if (!riderId || stopping) {
        if (!riderId && recoveryTimer) {
          clearInterval(recoveryTimer);
          recoveryTimer = null;
        }
        return;
      }

      const taskIsRunning = !supportsBackgroundLocation
        ? foregroundLocationSubscription !== null
        : await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
      if (
        taskIsRunning &&
        broadcastStatus.isRunning &&
        !isLocationFresh(latestPosition)
      ) {
        const now = Date.now();
        if (now - lastStaleLocationRecoveryAt < LOCATION_STALE_AFTER_MS) return;
        lastStaleLocationRecoveryAt = now;
      }
      if (
        broadcastStatus.isRunning &&
        broadcastStatus.state !== 'error' &&
        taskIsRunning &&
        isLocationFresh(latestPosition)
      ) return;

      const operation = generation;
      await start(riderId, operation, false);
    } catch (error) {
      console.error('Could not recover location broadcasting; will retry.', error);
    } finally {
      recoveryInFlight = false;
    }
  }

  if (Platform.OS !== 'web') {
    NetInfo.addEventListener((state) => {
      const isOnline = state.isConnected === true && state.isInternetReachable !== false;
      if (!isOnline) {
        wasOffline = true;
        return;
      }

      if (!wasOffline) return;
      wasOffline = false;

      if (latestPosition) void syncToDatabaseSmart(latestPosition, true);
      void flushPendingLocationSync();
      void (async () => {
        if (channel) await discardBroadcastChannel(channel);
        if (activeRiderId || await AsyncStorage.getItem(RIDER_ID_STORAGE_KEY)) {
          updateBroadcastStatus({ state: 'error', isRunning: true });
        }
        await recoverLocationBroadcast();
      })().catch((error: unknown) => {
        console.error('Could not restore rider location after reconnecting.', error);
      });
    });

    AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        if (!activeRiderId || pendingDBSyncFailed) void flushPendingLocationSync();
        void recoverLocationBroadcast();
      }
    });
  }

  async function sendBackgroundLocations(locations: Location.LocationObject[]): Promise<void> {
    const operation = generation;
    const riderId = await AsyncStorage.getItem(RIDER_ID_STORAGE_KEY);
    if (!riderId || stopping || operation !== generation) return;

    const location = locations[locations.length - 1];
    if (!location) return;

    const position: RiderPosition = {
      rider_id: riderId,
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      timestamp: location.timestamp,
    };

    activeRiderId = riderId;
    latestPosition = position;
    updateBroadcastStatus({ isRunning: true });

    if (
      stopping ||
      operation !== generation ||
      (await AsyncStorage.getItem(RIDER_ID_STORAGE_KEY)) !== riderId
    ) return;

    await storePendingLocation(position);
    void syncToDatabaseSmart(position, false);
    await broadcastPosition(position, operation);
  }

  TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
    if (error) {
      console.error('Background location task failed.', error);
      const riderId = await AsyncStorage.getItem(RIDER_ID_STORAGE_KEY);
      if (stopping || !riderId) return;

      updateBroadcastStatus({
        state: 'error',
        isRunning: true,
        error: error.message,
      });
      startRecoveryMonitor();
      return;
    }

    try {
      const taskData = data as { locations?: Location.LocationObject[] } | undefined;
      if (taskData?.locations?.length) {
        await sendBackgroundLocations(taskData.locations);
      }
    } catch (taskError) {
      console.error('Could not process a background location update.', taskError);
      const riderId = await AsyncStorage.getItem(RIDER_ID_STORAGE_KEY);
      if (stopping || !riderId) return;

      updateBroadcastStatus({
        state: 'error',
        isRunning: true,
        error: taskError instanceof Error ? taskError.message : String(taskError),
      });
      startRecoveryMonitor();
    }
  });

  async function start(
    riderId: string,
    operation: number,
    requestPermissions: boolean,
  ): Promise<void> {
    try {
      stopping = false;
      updateBroadcastStatus({ state: 'starting', isRunning: true, error: null });

      if (!supportsBackgroundLocation) {
        foregroundLocationSubscription?.remove();
        foregroundLocationSubscription = null;
      } else {
        const taskManagerAvailable = await TaskManager.isAvailableAsync();
        if (!taskManagerAvailable) {
          throw new Error('Background location requires an installed development or production build.');
        }
      }

      if (operation !== generation) return;
      if (!(await Location.hasServicesEnabledAsync())) {
        throw new Error('Device location services are disabled.');
      }

      activeRiderId = riderId;
      await AsyncStorage.setItem(RIDER_ID_STORAGE_KEY, riderId);
      if (operation !== generation) {
        if (stopping && await AsyncStorage.getItem(RIDER_ID_STORAGE_KEY) === riderId) {
          await AsyncStorage.removeItem(RIDER_ID_STORAGE_KEY);
        }
        return;
      }

      if (Platform.OS !== 'web') {
        const foregroundPermission = requestPermissions
          ? await Location.requestForegroundPermissionsAsync()
          : await Location.getForegroundPermissionsAsync();
        if (foregroundPermission.status !== 'granted') {
          throw new Error('Foreground location permission was not granted.');
        }
      }
      if (operation !== generation) return;

      if (supportsBackgroundLocation) {
        const backgroundPermission = requestPermissions
          ? await Location.requestBackgroundPermissionsAsync()
          : await Location.getBackgroundPermissionsAsync();
        if (backgroundPermission.status !== 'granted') {
          throw new Error('Background location permission was not granted.');
        }
      }

      if (operation !== generation) return;

      if (supportsBackgroundLocation) {
        await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
          accuracy: Location.Accuracy.High,
          timeInterval: 10000,
          distanceInterval: 0,
          deferredUpdatesInterval: 5000,
          deferredUpdatesDistance: 0,
          pausesUpdatesAutomatically: false,
          showsBackgroundLocationIndicator: true,
          foregroundService: {
            notificationTitle: 'Rider location is active',
            notificationBody: 'App နောက်ခံတွင်ရှိနေချိန်တွင်လည်း သင့်တည်နေရာကို ပို့နေပါသည်။',
            notificationColor: '#f97316',
            killServiceOnDestroy: false,
          },
        });
      }

      if (operation !== generation) {
        if (stopping) await stopLocationTaskIfRunning();
        return;
      }

      const currentLocation = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      if (operation !== generation) return;

      latestPosition = {
        rider_id: riderId,
        latitude: currentLocation.coords.latitude,
        longitude: currentLocation.coords.longitude,
        timestamp: currentLocation.timestamp,
      };
      await storePendingLocation(latestPosition);

      await getBroadcastChannel();
      if (operation !== generation) return;

      if (!supportsBackgroundLocation) {
        foregroundLocationSubscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            timeInterval: 10000,
            distanceInterval: 0,
          },
          (location) => {
            void sendBackgroundLocations([location]).catch((error: unknown) => {
              console.error('Could not process a foreground location update.', error);
            });
          },
        );
        if (operation !== generation) {
          foregroundLocationSubscription.remove();
          foregroundLocationSubscription = null;
          return;
        }
      }

      updateBroadcastStatus({ state: 'waiting', isRunning: true, error: null });
      startHeartbeat(operation);
      startRecoveryMonitor();
      void syncToDatabaseSmart(latestPosition, requestPermissions);
      void broadcastPosition(latestPosition, operation);
    } catch (error) {
      if (operation !== generation) return;

      updateBroadcastStatus({
        state: 'error',
        isRunning: true,
        error: error instanceof Error ? error.message : String(error),
      });
      startRecoveryMonitor();
      throw error;
    }
  }

  export function startBroadcastingLocation(riderId: string): Promise<void> {
    if (!riderId.trim()) {
      return Promise.reject(new Error('A rider ID is required to broadcast location.'));
    }

    if (activeRiderId === riderId && broadcastStatus.isRunning) {
      return Promise.resolve();
    }

    if (pendingStart?.riderId === riderId) {
      return pendingStart.promise;
    }

    const operation = ++generation;
    const startPromise = start(riderId, operation, true);
    pendingStart = { riderId, promise: startPromise };

    const clearPendingStart = () => {
      if (pendingStart?.promise === startPromise) {
        pendingStart = null;
      }
    };
    void startPromise.then(clearPendingStart, clearPendingStart);

    return startPromise;
  }

  export async function stopBroadcastingLocation(): Promise<void> {
    const finalPosition = latestPosition;
    generation += 1;
    stopping = true;
    pendingStart = null;

    if (recoveryTimer) {
      clearInterval(recoveryTimer);
      recoveryTimer = null;
    }

    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }

    activeRiderId = null;
    latestPosition = null;

    let cleanupError: unknown;
    try {
      await AsyncStorage.removeItem(RIDER_ID_STORAGE_KEY);
    } catch (error) {
      cleanupError = error;
    }

    try {
      await stopLocationTaskIfRunning();
    } catch (error) {
      cleanupError ??= error;
    }

    updateBroadcastStatus({ state: 'idle', isRunning: false, error: null });

    const realtimeChannel = channel;
    channel = null;
    channelPromise = null;
    if (realtimeChannel) {
      try {
        const result = await supabase.removeChannel(realtimeChannel);
        if (result !== 'ok') {
          cleanupError ??= new Error(`Could not remove realtime channel: ${result}`);
        }
      } catch (error) {
        cleanupError ??= error;
      }
    }

    if (finalPosition) await syncToDatabaseSmart(finalPosition, true);
    lastDBSyncTime = 0;
    lastDBSyncAttemptTime = 0;
    if (cleanupError) throw cleanupError;
  }

  if (Platform.OS !== 'web') {
    startRecoveryMonitor();
    void recoverLocationBroadcast();
    void flushPendingLocationSync();
  }