import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { createLeafletMapHtml } from './leaflet-map-html';
import { isMapCoordinate, type LeafletMapProps } from './leaflet-map.types';

export default function LeafletMap(props: LeafletMapProps) {
  const webViewRef = useRef<WebView<unknown>>(null);
  const [isReady, setIsReady] = useState(false);
  const initialCenterRef = useRef(props.initialCenter);
  const sourceHtml = useMemo(
    () => createLeafletMapHtml(initialCenterRef.current),
    [initialCenterRef],
  );

  useEffect(() => {
    if (!isReady) return;

    const state = {
      userLocation: props.userLocation,
      senderLocations: props.senderLocations,
      focusedSender: props.focusedSender,
      destination: props.destination,
      routeCoords: props.routeCoords,
      focusLocation: props.focusLocation,
      focusVersion: props.focusVersion,
      focusZoom: props.focusZoom,
    };
    webViewRef.current?.injectJavaScript(
      `window.updateLeafletMap(${JSON.stringify(state)}); true;`,
    );
  }, [
    isReady,
    props.destination,
    props.focusLocation,
    props.focusVersion,
    props.focusZoom,
    props.routeCoords,
    props.focusedSender,
    props.senderLocations,
    props.userLocation,
  ]);

  const handleMessage = (event: WebViewMessageEvent) => {
    let message: unknown;
    try {
      message = JSON.parse(event.nativeEvent.data);
    } catch (error) {
      console.error('Invalid message received from Leaflet map:', error);
      return;
    }

    if (
      message &&
      typeof message === 'object' &&
      'type' in message &&
      message.type === 'mapPress' &&
      'coordinate' in message &&
      isMapCoordinate(message.coordinate)
    ) {
      props.onMapPress(message.coordinate);
    }
  };

  return (
    <View style={styles.container}>
      <WebView<unknown>
        ref={webViewRef}
        source={{ html: sourceHtml }}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        style={styles.webView}
        onLoadEnd={() => setIsReady(true)}
        onMessage={handleMessage}
        onError={(event) => {
          console.error('Leaflet map failed to load:', event.nativeEvent.description);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
  },
  webView: {
    flex: 1,
  },
});
