import React, { useRef, type ComponentProps } from 'react';
import {
    ActivityIndicator,
    RefreshControl as NativeRefreshControl,
    Platform,
    StyleSheet,
    View,
    type GestureResponderEvent,
} from 'react-native';

type Props = ComponentProps<typeof NativeRefreshControl> & {
  children?: React.ReactNode;
};

type PullGesture = {
  startY: number;
  distance: number;
  scrollView: HTMLElement;
};

function findScrollView(event: GestureResponderEvent) {
  let element = event.target as unknown as HTMLElement | null;
  const boundary = event.currentTarget as unknown as HTMLElement;

  while (element && element !== boundary) {
    const overflowY = window.getComputedStyle(element).overflowY;
    if (
      (overflowY === 'auto' || overflowY === 'scroll') &&
      element.scrollHeight > element.clientHeight
    ) {
      return element;
    }
    element = element.parentElement;
  }

  return null;
}

export function PullToRefreshControl({
  children,
  colors,
  onRefresh,
  refreshing,
  style,
  tintColor,
  ...nativeProps
}: Props) {
  const pullGesture = useRef<PullGesture | null>(null);

  if (Platform.OS !== 'web') {
    return (
      <NativeRefreshControl
        {...nativeProps}
        colors={colors}
        onRefresh={onRefresh}
        refreshing={refreshing}
        tintColor={tintColor}
        style={style}
      >
        {children}
      </NativeRefreshControl>
    );
  }

  const handleTouchStart = (event: GestureResponderEvent) => {
    if (refreshing || !onRefresh) return;

    const scrollView = findScrollView(event);
    const startY = event.nativeEvent.touches[0]?.pageY;
    if (!scrollView || scrollView.scrollTop > 1 || startY === undefined) return;

    pullGesture.current = { startY, distance: 0, scrollView };
  };

  const handleTouchMove = (event: GestureResponderEvent) => {
    const gesture = pullGesture.current;
    const currentY = event.nativeEvent.touches[0]?.pageY;
    if (!gesture || currentY === undefined) return;

    if (gesture.scrollView.scrollTop > 1) {
      pullGesture.current = null;
      return;
    }
    gesture.distance = Math.max(gesture.distance, currentY - gesture.startY);
  };

  const handleTouchEnd = () => {
    const gesture = pullGesture.current;
    pullGesture.current = null;
    if (gesture && gesture.distance >= 72 && gesture.scrollView.scrollTop <= 1 && !refreshing) {
      onRefresh?.();
    }
  };

  return (
    <View
      style={[style, styles.webContainer]}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={() => { pullGesture.current = null; }}
    >
      {refreshing ? (
        <View pointerEvents="none" style={styles.indicator}>
          <ActivityIndicator size="small" color={tintColor ?? colors?.[0] ?? '#f97316'} />
        </View>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  webContainer: {
    flex: 1,
    position: 'relative',
  },
  indicator: {
    position: 'absolute',
    top: 12,
    left: 0,
    right: 0,
    zIndex: 1,
    alignItems: 'center',
  },
});