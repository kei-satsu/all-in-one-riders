import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createLeafletMapHtml } from './leaflet-map-html';
import { isMapCoordinate, type LeafletMapProps } from './leaflet-map.types';

export default function LeafletMap(props: LeafletMapProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isReady, setIsReady] = useState(false);
  const initialCenterRef = useRef(props.initialCenter);
  const sourceHtml = useMemo(
    () => createLeafletMapHtml(initialCenterRef.current),
    [initialCenterRef],
  );

  useEffect(() => {
    if (!isReady) return;

    iframeRef.current?.contentWindow?.postMessage({
      type: 'update',
      state: {
        userLocation: props.userLocation,
        senderLocations: props.senderLocations,
        focusedSender: props.focusedSender,
        destination: props.destination,
        routeCoords: props.routeCoords,
        focusLocation: props.focusLocation,
        focusVersion: props.focusVersion,
        focusZoom: props.focusZoom,
      },
    }, '*');
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

  useEffect(() => {
    const handleMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const message = event.data;
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

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [props.onMapPress]);

  return (
    <iframe
      ref={iframeRef}
      title="Leaflet delivery map"
      srcDoc={sourceHtml}
      onLoad={() => setIsReady(true)}
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        width: '100%',
        height: '100%',
        border: 0,
      }}
    />
  );
}
