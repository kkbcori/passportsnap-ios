/**
 * PaywallScreen — purchase options before download
 * Updated: price $1.50 (matches new Android version), platform-aware payment copy
 */
import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, ActivityIndicator, Alert, Modal, Platform,
} from 'react-native';
import Purchases from 'react-native-purchases';

const PRODUCT_SINGLE = 'passport_single';
const PRODUCT_4X6    = 'passport_4x6';

interface Props {
  visible:     boolean;
  onClose:     () => void;
  onPurchased: (type: 'single' | '4x6') => void;
  country?:    string;
}

export default function PaywallScreen({ visible, onClose, onPurchased, country }: Props) {
  const [loading, setLoading] = useState<string | null>(null);

  const purchase = async (type: 'single' | '4x6') => {
    const productId = type === 'single' ? PRODUCT_SINGLE : PRODUCT_4X6;
    setLoading(type);
    try {
      const offerings = await Purchases.getOfferings();
      if (!offerings.current) throw new Error('No offerings available');

      const pkg = offerings.current.availablePackages.find(
        p => p.product.identifier === productId
      );
      if (!pkg) throw new Error('Product not found. Please try again.');

      const { customerInfo } = await Purchases.purchasePackage(pkg);

      const entitlementId = type === 'single' ? 'download_single' : 'download_4x6';
      if (customerInfo.entitlements.active[entitlementId]) {
        onPurchased(type);
      } else {
        Alert.alert('Purchase issue',
          'Payment received but entitlement not found. Please contact support.');
      }
    } catch (e: any) {
      if (!e?.userCancelled) {
        Alert.alert('Purchase failed', e?.message ?? 'Please try again.');
      }
    } finally {
      setLoading(null);
    }
  };

  const countryLabel =
    country === 'GBR' ? 'UK'          :
    country === 'AUS' ? 'Australia'   :
    country === 'IND' ? 'India'       :
    country === 'CAN' ? 'Canada'      :
    country === 'SCH' ? 'Schengen'    :
    country === 'DEU' ? 'Germany'     :
    country === 'ZAF' ? 'South Africa': 'US';

  const paymentCopy = Platform.OS === 'ios'
    ? '🔐  Secure payment via Apple Pay'
    : '🔐  Secure payment via Google Play';

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.safe}>

        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.headerTitle}>Download Your Photo</Text>
            <Text style={styles.headerSub}>{countryLabel} Passport · Ready to use</Text>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Text style={styles.closeX}>✕</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.noticeBanner}>
          <Text style={styles.noticeIcon}>🔒</Text>
          <Text style={styles.noticeText}>
            Your photo is ready. Purchase to download without the watermark.
          </Text>
        </View>

        <View style={styles.products}>

          {/* Single photo — $1.50 */}
          <View style={styles.productCard}>
            <View style={styles.productTop}>
              <View style={styles.productIcon}>
                <Text style={styles.productEmoji}>🖼️</Text>
              </View>
              <View style={styles.productInfo}>
                <Text style={styles.productName}>Single Photo</Text>
                <Text style={styles.productDesc}>
                  One passport photo · Full resolution · No watermark
                </Text>
                <View style={styles.productTags}>
                  <Text style={styles.tag}>2×2 in</Text>
                  <Text style={styles.tag}>300 DPI</Text>
                  <Text style={styles.tag}>Instant download</Text>
                </View>
              </View>
            </View>
            <TouchableOpacity
              style={[styles.buyBtn, styles.buyBtnSecondary]}
              onPress={() => purchase('single')}
              disabled={loading !== null}
              activeOpacity={0.85}
            >
              {loading === 'single'
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.buyBtnText}>
                    Buy for <Text style={styles.buyBtnPrice}>$1.50</Text>
                  </Text>
              }
            </TouchableOpacity>
          </View>

          {/* 4×6 print sheet — $1.50 */}
          <View style={[styles.productCard, styles.productCardFeatured]}>
            <View style={styles.featuredBadge}>
              <Text style={styles.featuredBadgeText}>BEST VALUE</Text>
            </View>
            <View style={styles.productTop}>
              <View style={[styles.productIcon, styles.productIconGold]}>
                <Text style={styles.productEmoji}>🖨️</Text>
              </View>
              <View style={styles.productInfo}>
                <Text style={[styles.productName, styles.productNameGold]}>4×6 Print Sheet</Text>
                <Text style={styles.productDesc}>
                  2 photos on a 4×6 print-ready sheet · Take to any photo lab
                </Text>
                <View style={styles.productTags}>
                  <Text style={[styles.tag, styles.tagGold]}>Print ready</Text>
                  <Text style={[styles.tag, styles.tagGold]}>2 photos</Text>
                  <Text style={[styles.tag, styles.tagGold]}>Lab quality</Text>
                </View>
              </View>
            </View>
            <TouchableOpacity
              style={[styles.buyBtn, styles.buyBtnPrimary]}
              onPress={() => purchase('4x6')}
              disabled={loading !== null}
              activeOpacity={0.85}
            >
              {loading === '4x6'
                ? <ActivityIndicator color="#0A1628" />
                : <Text style={[styles.buyBtnText, styles.buyBtnTextDark]}>
                    Buy for <Text style={styles.buyBtnPriceGold}>$1.50</Text>
                  </Text>
              }
            </TouchableOpacity>
          </View>

        </View>

        <View style={styles.trust}>
          <Text style={styles.trustText}>{paymentCopy}</Text>
          <Text style={styles.trustText}>↩  No subscription · One-time purchase</Text>
          <Text style={styles.trustText}>📸  Photo processed locally · Never stored</Text>
        </View>

      </SafeAreaView>
    </Modal>
  );
}

const C = {
  bg: '#0C0F1A', surface: '#151929', border: '#1E2438',
  text1: '#F0F2FF', text2: '#A8B1CC', text3: '#6B7294',
  accent: '#2B59C3', accentLight: 'rgba(43,89,195,0.15)',
  gold: '#F5A623', goldBg: 'rgba(245,166,35,0.10)',
};

const styles = StyleSheet.create({
  safe:               { flex: 1, backgroundColor: C.bg },
  header:             { flexDirection: 'row', alignItems: 'center',
                        backgroundColor: C.bg, padding: 20, paddingBottom: 16,
                        borderBottomWidth: 1, borderBottomColor: C.border },
  headerLeft:         { flex: 1 },
  headerTitle:        { fontSize: 18, fontWeight: '700', color: C.text1 },
  headerSub:          { fontSize: 12, color: C.text3, marginTop: 2 },
  closeBtn:           { width: 32, height: 32, borderRadius: 16,
                        backgroundColor: C.surface,
                        alignItems: 'center', justifyContent: 'center' },
  closeX:             { color: C.text3, fontSize: 14, fontWeight: '500' },
  noticeBanner:       { flexDirection: 'row', alignItems: 'center', gap: 10,
                        backgroundColor: C.accentLight, margin: 16, borderRadius: 12,
                        padding: 12, borderWidth: 1, borderColor: 'rgba(43,89,195,0.25)' },
  noticeIcon:         { fontSize: 16 },
  noticeText:         { flex: 1, fontSize: 12, color: '#4A7AE8', lineHeight: 17 },
  products:           { paddingHorizontal: 16, gap: 12 },
  productCard:        { backgroundColor: C.surface, borderRadius: 14, padding: 18,
                        borderWidth: 1, borderColor: C.border },
  productCardFeatured:{ borderColor: C.gold, position: 'relative', marginTop: 8 },
  featuredBadge:      { position: 'absolute', top: -11, alignSelf: 'center',
                        backgroundColor: C.gold, borderRadius: 8,
                        paddingHorizontal: 12, paddingVertical: 3 },
  featuredBadgeText:  { fontSize: 9, fontWeight: '700', color: '#0C0F1A', letterSpacing: 1.5 },
  productTop:         { flexDirection: 'row', gap: 14, marginBottom: 16 },
  productIcon:        { width: 44, height: 44, borderRadius: 12,
                        backgroundColor: C.accentLight,
                        alignItems: 'center', justifyContent: 'center' },
  productIconGold:    { backgroundColor: C.goldBg },
  productEmoji:       { fontSize: 22 },
  productInfo:        { flex: 1 },
  productName:        { fontSize: 15, fontWeight: '700', color: C.text1, marginBottom: 3 },
  productNameGold:    { color: C.gold },
  productDesc:        { fontSize: 12, color: C.text3, lineHeight: 17, marginBottom: 8 },
  productTags:        { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag:                { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 8,
                        paddingHorizontal: 8, paddingVertical: 3,
                        fontSize: 10, color: C.text2, fontWeight: '500' },
  tagGold:            { backgroundColor: C.goldBg, color: C.gold },
  buyBtn:             { borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  buyBtnSecondary:    { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  buyBtnPrimary:      { backgroundColor: C.gold },
  buyBtnText:         { fontSize: 14, fontWeight: '600', color: C.text2 },
  buyBtnTextDark:     { color: '#0C0F1A' },
  buyBtnPrice:        { fontSize: 15, fontWeight: '700' },
  buyBtnPriceGold:    { fontSize: 15, fontWeight: '700', color: '#0C0F1A' },
  trust:              { padding: 24, gap: 6, marginTop: 8 },
  trustText:          { fontSize: 11, color: C.text3, textAlign: 'center', lineHeight: 18 },
});
