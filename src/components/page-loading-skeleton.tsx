import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

type SkeletonVariant = 'parcel' | 'pickup' | 'profile' | 'search';

type PageLoadingSkeletonProps = {
  isDark: boolean;
  variant?: SkeletonVariant;
  count?: number;
  inline?: boolean;
};

export function PageLoadingSkeleton({
  isDark,
  variant = 'parcel',
  count = 3,
  inline = false,
}: PageLoadingSkeletonProps) {
  const shimmer = useSharedValue(0.35);
  const shimmerStyle = useAnimatedStyle(() => ({ opacity: shimmer.value }));
  const surface = isDark ? '#151c2a' : '#ffffff';
  const placeholder = isDark ? '#293447' : '#e9eef5';

  useEffect(() => () => cancelAnimation(shimmer), [shimmer]);

  const startShimmer = () => {
    // Reanimated shared values need a direct assignment to start UI-thread animations.
    // eslint-disable-next-line react-hooks/immutability
    shimmer.value = withRepeat(withTiming(0.9, { duration: 850 }), -1, true);
  };

  const block = (width: number | `${number}%`, height: number, radius = 6) => (
    <Animated.View
      style={[{ width, height, borderRadius: radius, backgroundColor: placeholder }, shimmerStyle]}
    />
  );

  const renderParcel = (key: number) => (
    <View key={key} style={[styles.card, { backgroundColor: surface, borderColor: placeholder }]}>
      {block(70, 88, 8)}
      <View style={styles.parcelBody}>
        <View style={styles.row}>
          {block('46%', 12)}
          {block('28%', 12)}
        </View>
        <View style={styles.row}>
          {block('40%', 10)}
          {block(12, 10, 6)}
          {block('42%', 10)}
        </View>
        {block('66%', 10)}
        {block('92%', 10)}
        <View style={styles.row}>
          {block('28%', 10)}
          {block('28%', 10)}
          {block('28%', 10)}
        </View>
        {block('100%', 30, 8)}
      </View>
    </View>
  );

  const renderPickup = (key: number) => (
    <View key={key} style={[styles.pickupCard, { backgroundColor: surface, borderColor: placeholder }]}>
      <View style={styles.row}>
        {block(42, 42, 12)}
        <View style={styles.pickupHeader}>
          {block('66%', 13)}
          {block('44%', 10)}
        </View>
      </View>
      {block('58%', 10)}
      {block('88%', 10)}
      {block('72%', 10)}
      {block('100%', 34, 8)}
    </View>
  );

  const renderInline = (key: number) => (
    <View key={key} style={styles.inlineRow}>
      <View style={styles.inlineText}>
        {block('72%', 12)}
        {block('48%', 10)}
      </View>
    </View>
  );

  return (
    <View
      onLayout={startShimmer}
      style={inline ? styles.inlineContainer : styles.listContainer}
    >
      {Array.from({ length: count }, (_, index) =>
        variant === 'parcel'
          ? renderParcel(index)
          : variant === 'pickup'
            ? renderPickup(index)
            : renderInline(index)
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  listContainer: {
    flex: 1,
    gap: 12,
    paddingHorizontal: 12,
    paddingTop: 14,
  },
  inlineContainer: {
    width: '100%',
    gap: 8,
  },
  card: {
    flexDirection: 'row',
    gap: 10,
    padding: 10,
    borderWidth: 1,
    borderRadius: 12,
  },
  parcelBody: {
    flex: 1,
    gap: 8,
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  pickupCard: {
    gap: 11,
    padding: 14,
    borderWidth: 1,
    borderRadius: 14,
  },
  pickupHeader: {
    flex: 1,
    gap: 7,
  },
  inlineRow: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  inlineText: {
    flex: 1,
    gap: 6,
  },
});
