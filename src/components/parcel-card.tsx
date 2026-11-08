import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useThemeStyles } from '../lib/theme-provider';

export type ParcelCardData = {
  id: string | number;
  item_id: string | number | null;
  barcode: string | number | null;
  sender_name: string | null;
  receiver_name: string | null;
  receiver_phone: string | null;
  receiver_address: string | null;
  cod_amount: number | string | null;
  deli_fee: number | string | null;
  total_amount: number | string | null;
  image_url: string | null;
};

type ParcelCardProps = {
  parcel: ParcelCardData;
  action?: ReactNode;
  date?: string | null;
};

function formatAmount(amount: number | string | null) {
  if (amount == null || amount === '') return '-';
  const value = Number(amount);
  return Number.isNaN(value) ? `${amount}` : value.toLocaleString();
}

function formatDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
  });
}

export function ParcelCard({ parcel, action, date }: ParcelCardProps) {
  const styles = useThemeStyles(baseStyles);
  const code = parcel.item_id ?? 'N/A';
  const barcode = parcel.barcode ?? 'N/A';
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const thumbnailRef = useRef<any>(null);
  const closingRef = useRef(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const imageLeft = useSharedValue(0);
  const imageTop = useSharedValue(0);
  const imageWidth = useSharedValue(0);
  const imageHeight = useSharedValue(0);
  const originLeft = useSharedValue(0);
  const originTop = useSharedValue(0);
  const originWidth = useSharedValue(0);
  const originHeight = useSharedValue(0);
  const backdropOpacity = useSharedValue(0);

  const previewWidth = Math.max(1, windowWidth - 32);
  const previewHeight = Math.max(1, Math.min(windowHeight * 0.72, windowHeight - 120));
  const previewLeft = (windowWidth - previewWidth) / 2;
  const previewTop = (windowHeight - previewHeight) / 2;

  const imageStyle = useAnimatedStyle(() => ({
    left: imageLeft.value,
    top: imageTop.value,
    width: imageWidth.value,
    height: imageHeight.value,
  }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  useEffect(() => {
    if (!previewVisible) return;

    imageLeft.value = withTiming(previewLeft, { duration: 280 });
    imageTop.value = withTiming(previewTop, { duration: 280 });
    imageWidth.value = withTiming(previewWidth, { duration: 280 });
    imageHeight.value = withTiming(previewHeight, { duration: 280 });
    backdropOpacity.value = withTiming(1, { duration: 220 });
  }, [
    backdropOpacity,
    imageHeight,
    imageLeft,
    imageTop,
    imageWidth,
    previewHeight,
    previewLeft,
    previewTop,
    previewVisible,
    previewWidth,
  ]);

  const openPreview = useCallback(() => {
    if (!parcel.image_url) return;

    thumbnailRef.current?.measureInWindow((left: number, top: number, width: number, height: number) => {
      imageLeft.value = left;
      imageTop.value = top;
      imageWidth.value = width;
      imageHeight.value = height;
      originLeft.value = left;
      originTop.value = top;
      originWidth.value = width;
      originHeight.value = height;
      backdropOpacity.value = 0;
      closingRef.current = false;
      setPreviewVisible(true);
    });
  }, [
    backdropOpacity,
    imageHeight,
    imageLeft,
    imageTop,
    imageWidth,
    originHeight,
    originLeft,
    originTop,
    originWidth,
    parcel.image_url,
  ]);

  const closePreview = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;

    imageLeft.value = withTiming(originLeft.value, { duration: 260 });
    imageTop.value = withTiming(originTop.value, { duration: 260 });
    imageWidth.value = withTiming(originWidth.value, { duration: 260 });
    imageHeight.value = withTiming(originHeight.value, { duration: 260 }, (finished) => {
      if (finished) runOnJS(setPreviewVisible)(false);
    });
    backdropOpacity.value = withTiming(0, { duration: 220 });
  }, [
    backdropOpacity,
    imageHeight,
    imageLeft,
    imageTop,
    imageWidth,
    originHeight,
    originLeft,
    originTop,
    originWidth,
  ]);

  return (
    <View style={styles.card}>
      <View style={styles.imageColumn}>
        {/* Thumbnail */}
        {parcel.image_url ? (
          <Pressable
            ref={thumbnailRef}
            onPress={openPreview}
            accessibilityRole="imagebutton"
            accessibilityLabel="ပစ္စည်းပုံကို အကြီးကြည့်ရန်"
          >
            <Image
              source={{ uri: parcel.image_url }}
              style={styles.image}
              contentFit="cover"
              cachePolicy="disk"
              transition={150}
              accessibilityLabel="ပစ္စည်းပုံ"
            />
          </Pressable>
        ) : (
          <View style={[styles.image, styles.imagePlaceholder]}>
            <Ionicons name="cube-outline" size={22} color="#94a3b8" />
          </View>
        )}
        <View style={styles.itemCodeChip}>
          <Ionicons name="barcode-outline" size={11} color="#0369a1" />
          <Text style={styles.itemCodeText} numberOfLines={1}>
            {code}
          </Text>
        </View>
      </View>

      {/* Content */}
      <View style={styles.body}>
        {/* Header: barcode + date */}
        <View style={styles.header}>
          <View style={styles.codeChip}>
            <Ionicons name="barcode-outline" size={12} color="#0369a1" />
            <Text style={styles.codeText} numberOfLines={1}>
              {barcode}
            </Text>
          </View>
          {date ? (
            <View style={styles.dateChip}>
              <Ionicons name="calendar-outline" size={11} color="#64748b" />
              <Text style={styles.dateText}>{formatDate(date)}</Text>
            </View>
          ) : null}
        </View>

        {/* Sender → Receiver */}
        <View style={styles.routeRow}>
          <Text style={styles.routeName} numberOfLines={1}>
            {parcel.sender_name || '-'}
          </Text>
          <Ionicons name="arrow-forward" size={12} color="#94a3b8" />
          <Text style={[styles.routeName, styles.routeNameEnd]} numberOfLines={1}>
            {parcel.receiver_name || '-'}
          </Text>
        </View>

        {/* Phone + Address */}
        <View style={styles.metaRow}>
          <Ionicons name="call-outline" size={12} color="#64748b" />
          <Text style={styles.metaText} numberOfLines={1}>
            {parcel.receiver_phone || '-'}
          </Text>
        </View>
        <View style={styles.metaRow}>
          <Ionicons name="location-outline" size={12} color="#64748b" />
          <Text style={styles.metaText} numberOfLines={2}>
            {parcel.receiver_address || '-'}
          </Text>
        </View>

        {/* Amounts */}
        <View style={styles.amounts}>
          <View style={styles.amountItem}>
            <Text style={styles.amountLabel}>COD</Text>
            <Text style={styles.amountValue}>{formatAmount(parcel.cod_amount)}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.amountItem}>
            <Text style={styles.amountLabel}>ပို့ခ</Text>
            <Text style={styles.amountValue}>{formatAmount(parcel.deli_fee)}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.amountItem}>
            <Text style={styles.amountLabel}>စုစုပေါင်း</Text>
            <Text style={styles.amountTotal}>{formatAmount(parcel.total_amount)}</Text>
          </View>
        </View>

        {/* Action */}
        {action ? <View style={styles.actionWrap}>{action}</View> : null}
      </View>

      <Modal
        visible={previewVisible}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={closePreview}
      >
        <View style={styles.previewOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={closePreview}
            accessibilityRole="button"
            accessibilityLabel="ပုံကို ပိတ်ရန်"
          >
            <Animated.View style={[styles.previewBackdrop, backdropStyle]} />
          </Pressable>
          <Animated.View style={[styles.previewImageFrame, imageStyle]}>
            {parcel.image_url ? (
              <Image
                source={{ uri: parcel.image_url }}
                style={styles.previewImage}
                contentFit="contain"
                cachePolicy="disk"
                accessibilityLabel="အကြီးချဲ့ထားသော ပစ္စည်းပုံ"
              />
            ) : null}
          </Animated.View>
          <Pressable
            style={[
              styles.previewClose,
              { top: previewTop + 8, right: previewLeft + 8 },
            ]}
            onPress={closePreview}
            accessibilityRole="button"
            accessibilityLabel="ပုံကို ပိတ်ရန်"
          >
            <Ionicons name="close-circle" size={34} color="#ffffff" />
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

const baseStyles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    marginBottom: 10,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  imageColumn: {
    flexShrink: 0,
  },
  image: {
    width: 78,
    height: 96,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
  },
  imagePlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewOverlay: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  previewBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#000000',
  },
  previewImageFrame: {
    position: 'absolute',
    overflow: 'hidden',
    borderRadius: 12,
    backgroundColor: '#0f172a',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  previewClose: {
    position: 'absolute',
    zIndex: 1,
    elevation: 4,
    padding: 4,
    borderRadius: 20,
    backgroundColor: 'rgba(15, 23, 42, 0.7)',
  },
  body: {
    flex: 1,
    minWidth: 0,
    marginLeft: 10,
    justifyContent: 'space-between',
  },

  /* Header */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    marginBottom: 5,
  },
  codeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: '#e0f2fe',
    maxWidth: '65%',
  },
  codeText: {
    color: '#0369a1',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  itemCodeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    marginTop: 5,
    paddingHorizontal: 4,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: '#e0f2fe',
  },
  itemCodeText: {
    flexShrink: 1,
    color: '#0369a1',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  dateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  dateText: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: '500',
  },

  /* Route */
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 4,
  },
  routeName: {
    flex: 1,
    minWidth: 0,
    color: '#0f172a',
    fontSize: 12,
    fontWeight: '600',
  },
  routeNameEnd: {
    textAlign: 'right',
  },

  /* Meta */
  metaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 5,
    marginBottom: 2,
  },
  metaText: {
    flex: 1,
    minWidth: 0,
    color: '#475569',
    fontSize: 11,
    lineHeight: 15,
  },

  /* Amounts */
  amounts: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: '#f8fafc',
  },
  amountItem: {
    flex: 1,
    minWidth: 0,
  },
  amountLabel: {
    color: '#94a3b8',
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 0.3,
    marginBottom: 1,
  },
  amountValue: {
    color: '#334155',
    fontSize: 11,
    fontWeight: '600',
  },
  amountTotal: {
    color: '#c2410c',
    fontSize: 11,
    fontWeight: '800',
  },
  divider: {
    width: 1,
    height: 18,
    marginHorizontal: 6,
    backgroundColor: '#e2e8f0',
  },

  /* Action */
  actionWrap: {
    marginTop: 8,
  },
});