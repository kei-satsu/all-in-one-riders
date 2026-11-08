import type { MapCoordinate } from './leaflet-map.types';

export function createLeafletMapHtml(initialCenter: MapCoordinate) {
  return `<!DOCTYPE html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <style>
      html, body, #map { width: 100%; height: 100%; margin: 0; padding: 0; }
      .leaflet-control-attribution { font-size: 10px; }
      .sender-name-label {
        padding: 4px 9px !important;
        border: 0 !important;
        border-radius: 14px !important;
        background: #14532d !important;
        color: #ffffff !important;
        font-size: 12px !important;
        font-weight: 700 !important;
        box-shadow: 0 2px 8px rgba(15, 23, 42, 0.3) !important;
        white-space: nowrap;
      }
      .sender-name-label::before { display: none !important; }
    </style>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  </head>
  <body>
    <div id="map"></div>
    <script>
      (function () {
        const map = L.map('map').setView(
          [${initialCenter.latitude}, ${initialCenter.longitude}],
          16
        );
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(map);

        let userMarker = null;
        const senderMarkers = L.layerGroup().addTo(map);
        let senderLocationsSignature = '';
        let focusedSenderSignature = '';
        let destinationMarker = null;
        let routeLine = null;
        let lastFocusVersion = -1;

        function sendMapPress(coordinate) {
          const message = JSON.stringify({
            type: 'mapPress',
            coordinate: {
              latitude: coordinate.lat,
              longitude: coordinate.lng
            }
          });
          if (window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage(message);
          } else {
            window.parent.postMessage(JSON.parse(message), '*');
          }
        }

        map.on('click', function (event) {
          sendMapPress(event.latlng);
        });

        window.updateLeafletMap = function (state) {
          const senderLocations = Array.isArray(state.senderLocations) ? state.senderLocations : [];
          const focusedSender = state.focusedSender || null;
          const nextFocusedSenderSignature = JSON.stringify(focusedSender);
          const nextSenderLocationsSignature = JSON.stringify(senderLocations) + nextFocusedSenderSignature;
          if (nextSenderLocationsSignature !== senderLocationsSignature) {
            senderLocationsSignature = nextSenderLocationsSignature;
            senderMarkers.clearLayers();
            senderLocations.forEach(function (sender) {
              const isFocused = focusedSender &&
                sender.name === focusedSender.name &&
                sender.latitude === focusedSender.latitude &&
                sender.longitude === focusedSender.longitude;
              const marker = L.circleMarker([sender.latitude, sender.longitude], {
                radius: isFocused ? 11 : 7,
                color: '#ffffff',
                weight: isFocused ? 4 : 2,
                fillColor: isFocused ? '#f97316' : '#16a34a',
                fillOpacity: 1
              });
              const popup = document.createElement('span');
              popup.textContent = sender.name;
              marker.bindPopup(popup);
              if (isFocused) {
                marker.bindTooltip(sender.name, {
                  permanent: true,
                  direction: 'top',
                  className: 'sender-name-label',
                  offset: [0, -8]
                });
              }
              marker.on('click', L.DomEvent.stopPropagation);
              senderMarkers.addLayer(marker);
            });
          }

          if (state.userLocation) {
            const location = [state.userLocation.latitude, state.userLocation.longitude];
            if (userMarker) {
              userMarker.setLatLng(location);
            } else {
              userMarker = L.circleMarker(location, {
                radius: 8,
                color: '#ffffff',
                weight: 3,
                fillColor: '#0284c7',
                fillOpacity: 1
              }).addTo(map);
            }
          }

          if (state.destination) {
            const location = [state.destination.latitude, state.destination.longitude];
            if (destinationMarker) {
              destinationMarker.setLatLng(location);
            } else {
              destinationMarker = L.circleMarker(location, {
                radius: 9,
                color: '#ffffff',
                weight: 3,
                fillColor: '#f97316',
                fillOpacity: 1
              }).addTo(map);
            }
          } else if (destinationMarker) {
            map.removeLayer(destinationMarker);
            destinationMarker = null;
          }

          if (state.routeCoords && state.routeCoords.length > 0) {
            const route = state.routeCoords.map(function (point) {
              return [point.latitude, point.longitude];
            });
            if (routeLine) {
              routeLine.setLatLngs(route);
            } else {
              routeLine = L.polyline(route, {
                color: '#0284c7',
                weight: 4
              }).addTo(map);
            }
          } else if (routeLine) {
            map.removeLayer(routeLine);
            routeLine = null;
          }

          if (state.focusLocation && state.focusVersion !== lastFocusVersion) {
            lastFocusVersion = state.focusVersion;
            map.setView(
              [state.focusLocation.latitude, state.focusLocation.longitude],
              state.focusZoom || 16,
              { animate: true }
            );
          }
        };

        window.addEventListener('message', function (event) {
          const message = event.data;
          if (message && message.type === 'update') {
            window.updateLeafletMap(message.state);
          }
        });
      })();
    </script>
  </body>
</html>`;
}
