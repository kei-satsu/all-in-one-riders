import { Ionicons } from '@expo/vector-icons';
import { CameraView, type BarcodeScanningResult } from 'expo-camera';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useThemeStyles } from '../lib/theme-provider';

type BarcodeScannerProps = {
  onBarcodeScanned: (result: BarcodeScanningResult) => void;
  onClose: () => void;
};

export function BarcodeScanner({ onBarcodeScanned, onClose }: BarcodeScannerProps) {
  const styles = useThemeStyles(baseStyles);
  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{
          barcodeTypes: [
            'qr',
            'code128',
            'code39',
            'code93',
            'ean13',
            'ean8',
            'upc_a',
            'upc_e',
            'itf14',
            'codabar',
            'pdf417',
            'aztec',
            'datamatrix',
          ],
        }}
        onBarcodeScanned={onBarcodeScanned}
      />
      <SafeAreaView style={styles.overlay}>
        <View style={styles.header}>
          <Text style={styles.title}>QR / Barcode Scan</Text>
          <TouchableOpacity
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="ပိတ်ရန်"
          >
            <Ionicons name="close-circle" size={32} color="#ffffff" />
          </TouchableOpacity>
        </View>
        <View style={styles.scanFrame} />
        <Text style={styles.hint}>QR သို့ Barcode ကို ဘောင်အတွင်းထားပြီး ဖတ်ပါ</Text>
      </SafeAreaView>
    </View>
  );
}

const baseStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  overlay: {
    flex: 1,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  header: {
    width: '100%',
    paddingTop: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
  },
  scanFrame: {
    width: '78%',
    aspectRatio: 1,
    maxWidth: 300,
    maxHeight: 300,
    borderWidth: 3,
    borderColor: '#ffffff',
    borderRadius: 16,
  },
  hint: {
    width: '100%',
    padding: 12,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#00000099',
    color: '#ffffff',
    textAlign: 'center',
    fontSize: 14,
  },
});
