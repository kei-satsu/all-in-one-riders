export type MapCoordinate = {
  latitude: number;
  longitude: number;
};

export type SenderLocation = MapCoordinate & {
  id: string;
  name: string;
};

export type LeafletMapProps = {
  initialCenter: MapCoordinate;
  userLocation: MapCoordinate | null;
  senderLocations: SenderLocation[];
  focusedSender: SenderLocation | null;
  destination: MapCoordinate | null;
  routeCoords: MapCoordinate[];
  focusLocation: MapCoordinate | null;
  focusVersion: number;
  focusZoom: number;
  onMapPress: (coordinate: MapCoordinate) => void;
};

export function isMapCoordinate(value: unknown): value is MapCoordinate {
  if (!value || typeof value !== 'object') return false;
  const coordinate = value as Partial<MapCoordinate>;
  return Number.isFinite(coordinate.latitude) && Number.isFinite(coordinate.longitude);
}
