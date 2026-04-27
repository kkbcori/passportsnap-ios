/**
 * PaywallScreen — purchase options before download
 * Uses RevenueCat (react-native-purchases) for IAP
 * Products: passport_single ($1.59), passport_4x6 ($1.59), passport_bundle ($2.49)
 */
import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, ActivityIndicator, Alert, Modal, ScrollView,
} from 'react-native';

import Purchases from 'react-native-purchases';

// Product IDs (must match App Store Connect + RevenueCat exactly):
const PRODUCT_SINGLE = 'passport_single';   // $1.59 — single photo
const PRODUCT_4X6    = 'passport_4x6';      // $1.59 — 4x6 print sheet
const PRODUCT_BUNDLE = 'passport_bundle';   // $2.49 — both files

interface Props {
  visible:       boolean;
  onClose:       () => void;
  onPurchased:   (type: 'single' | '4x6' | 'bundle') => void;
  country?:      string;
}

export default function PaywallScreen({ visible, onClose, onPurchased, country }: Props) {
  const [loading, setLoading] = useState<string | null>(null);

  const purchase = async (type: 'single' | '4x6' | 'bundle') => {
    const productId = type === 'single' ? PRODUCT_SINGLE : type === '4x6' ? PRODUCT_4X6 : PRODUCT_BUNDLE;
    const entitlementId = type === 'single' ? 'download_single' : type === '4x6' ? 'download_4x6' : 'download_bundle';
    setLoading(type);
    try {
      let customerInfo;

      // PRIMARY: Try RC offerings (works when products are approved on App Store Connect)
      try {
        const offerings = await Purchases.getOfferings();
        if (offerings.current) {
          const pkg = offerings.current.availablePackages.find(
            p => p.product.identifier === productId
          );
          if (pkg) {
            const result = await Purchases.purchasePackage(pkg);
            customerInfo = result.customerInfo;
          }
        }
      } catch (offeringsError: any) {
        // Offerings failed — fall through to direct product purchase
        if (offeringsError?.userCancelled) {
          setLoading(null);
          return; // User cancelled — do not fall through
        }
      }

      // FALLBACK: Direct product purchase via RC (works with StoreKit config file
      // and during App Review when products are "Waiting for Review")
      if (!customerInfo) {
        const products = await Purchases.getProducts([productId]);
        if (!products || products.length === 0) {
          throw new Error('Product not available. Please check your connection and try again.');
        }
        const result = await Purchases.purchaseStoreProduct(products[0]);
        customerInfo = result.customerInfo;
      }

      // Verify entitlement or grant access directly for consumables
      if (customerInfo.entitlements.active[entitlementId]) {
        onPurchased(type);
      } else {
        // For consumables, RC entitlements may not persist — grant access directly
        onPurchased(type);
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
    country === 'GBR' ? 'UK' :
    country === 'AUS' ? 'Australia' :
    country === 'CAN' ? 'Canada' :
    country === 'SCH' ? 'Schengen' :
    country === 'DEU' ? 'Germany' :
    country === 'ZAF' ? 'South Africa' :
    country === 'IND' ? 'India' : 'US';

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe}>

        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.headerTitle}>Download Your Photo</Text>
            <Text style={styles.headerSub}>{countryLabel} Passport · Ready to use</Text>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Text style={styles.closeX}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

          {/* Watermark notice */}
          <View style={styles.noticeBanner}>
            <Text style={styles.noticeIcon}>🔒</Text>
            <Text style={styles.noticeText}>
              Your photo is ready. Purchase to download without the watermark.
            </Text>
          </View>

          {/* Products */}
          <View style={styles.products}>

            {/* Bundle — BEST VALUE */}
            <View style={[styles.productCard, styles.productCardBundle]}>
              <View style={styles.bundleBadge}>
                <Text style={styles.bundleBadgeText}>BEST VALUE</Text>
              </View>
              <View style={styles.productTop}>
                <View style={[styles.productIcon, styles.productIconGold]}>
                  <Text style={styles.productEmoji}>📦</Text>
                </View>
                <View style={styles.productInfo}>
                  <Text style={[styles.productName, styles.productNameGold]}>Bundle — Single + 4×6</Text>
                  <Text style={styles.productDesc}>
                    Both files included · Single photo + 4×6 print sheet · Save 17%
                  </Text>
                  <View style={styles.productTags}>
                    <Text style={[styles.tag, styles.tagGold]}>2 files</Text>
                    <Text style={[styles.tag, styles.tagGold]}>Best deal</Text>
                    <Text style={[styles.tag, styles.tagGold]}>No watermark</Text>
                  </View>
                </View>
              </View>
              <TouchableOpacity
                style={[styles.buyBtn, styles.buyBtnBundle]}
                onPress={() => purchase('bundle')}
                disabled={loading !== null}
                activeOpacity={0.85}
              >
                {loading === 'bundle'
                  ? <ActivityIndicator color="#0C0F1A" />
                  : <Text style={styles.buyBtnBundleText}>Buy for <Text style={styles.buyBtnBundlePrice}>$2.49</Text></Text>
                }
              </TouchableOpacity>
            </View>

            {/* Single photo — $1.59 */}
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
                    <Text style={styles.tag}>Print ready</Text>
                    <Text style={styles.tag}>300+ DPI</Text>
                    <Text style={styles.tag}>Instant</Text>
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
                  ? <ActivityIndicator color="#A8B1CC" />
                  : <Text style={styles.buyBtnText}>Buy for <Text style={styles.buyBtnPrice}>$1.59</Text></Text>
                }
              </TouchableOpacity>
            </View>

            {/* 4×6 print sheet — $1.59 */}
            <View style={styles.productCard}>
              <View style={styles.productTop}>
                <View style={styles.productIcon}>
                  <Text style={styles.productEmoji}>🖨️</Text>
                </View>
                <View style={styles.productInfo}>
                  <Text style={styles.productName}>4×6 Print Sheet</Text>
                  <Text style={styles.productDesc}>
                    2 photos on a 4×6 sheet · Take to any photo lab
                  </Text>
                  <View style={styles.productTags}>
                    <Text style={styles.tag}>Print ready</Text>
                    <Text style={styles.tag}>2 photos</Text>
                    <Text style={styles.tag}>Lab quality</Text>
                  </View>
                </View>
              </View>
              <TouchableOpacity
                style={[styles.buyBtn, styles.buyBtnSecondary]}
                onPress={() => purchase('4x6')}
                disabled={loading !== null}
                activeOpacity={0.85}
              >
                {loading === '4x6'
                  ? <ActivityIndicator color="#A8B1CC" />
                  : <Text style={styles.buyBtnText}>Buy for <Text style={styles.buyBtnPrice}>$1.59</Text></Text>
                }
              </TouchableOpacity>
            </View>

          </View>

          {/* Trust footer */}
          <View style={styles.trust}>
            <Text style={styles.trustText}>🔐  Secure payment via Apple</Text>
            <Text style={styles.trustText}>↩  No subscription · One-time purchase</Text>
            <Text style={styles.trustText}>📸  Photo processed locally · Never stored</Text>
          </View>

        </ScrollView>

      </SafeAreaView>
    </Modal>
  );
}

const C = {
  bg: '#0C0F1A', surface: '#151929', border: '#1E2438',
  text1: '#F0F2FF', text2: '#A8B1CC', text3: '#6B7294',
  accent: '#2B59C3', accentLight: 'rgba(43,89,195,0.15)',
  gold: '#F5A623', goldBg: 'rgba(245,166,35,0.10)', goldBorder: 'rgba(245,166,35,0.35)',
};

const styles = StyleSheet.create({
  safe:               { flex: 1, backgroundColor: C.bg },
  scrollContent:      { paddingBottom: 24 },

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
                        backgroundColor: C.accentLight, margin: 16, borderRadius: 10,
                        padding: 12, borderWidth: 1, borderColor: 'rgba(43,89,195,0.25)' },
  noticeIcon:         { fontSize: 16 },
  noticeText:         { flex: 1, fontSize: 12, color: '#4A7AE8', lineHeight: 17 },

  products:           { paddingHorizontal: 16, gap: 12 },

  productCard:        { backgroundColor: C.surface, borderRadius: 14, padding: 18,
                        borderWidth: 1, borderColor: C.border },
  productCardBundle:  { borderColor: C.goldBorder, borderWidth: 1.5, position: 'relative', marginTop: 4 },

  bundleBadge:        { position: 'absolute', top: -11, alignSelf: 'center',
                        backgroundColor: C.gold, borderRadius: 6,
                        paddingHorizontal: 12, paddingVertical: 3 },
  bundleBadgeText:    { fontSize: 9, fontWeight: '700', color: '#0C0F1A', letterSpacing: 1.5 },

  productTop:         { flexDirection: 'row', gap: 14, marginBottom: 16 },
  productIcon:        { width: 44, height: 44, borderRadius: 10,
                        backgroundColor: 'rgba(43,89,195,0.10)',
                        alignItems: 'center', justifyContent: 'center' },
  productIconGold:    { backgroundColor: C.goldBg },
  productEmoji:       { fontSize: 22 },
  productInfo:        { flex: 1 },
  productName:        { fontSize: 15, fontWeight: '700', color: C.text1, marginBottom: 3 },
  productNameGold:    { color: C.gold },
  productDesc:        { fontSize: 12, color: C.text3, lineHeight: 17, marginBottom: 8 },
  productTags:        { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag:                { backgroundColor: 'rgba(43,89,195,0.08)', borderRadius: 6,
                        paddingHorizontal: 8, paddingVertical: 3,
                        fontSize: 10, color: C.text2, fontWeight: '500', overflow: 'hidden' },
  tagGold:            { backgroundColor: C.goldBg, color: C.gold },

  buyBtn:             { borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  buyBtnSecondary:    { backgroundColor: 'rgba(43,89,195,0.10)', borderWidth: 1, borderColor: 'rgba(43,89,195,0.20)' },
  buyBtnBundle:       { backgroundColor: C.gold },
  buyBtnText:         { fontSize: 14, fontWeight: '600', color: C.text2 },
  buyBtnPrice:        { fontSize: 15, fontWeight: '700', color: C.text1 },
  buyBtnBundleText:   { fontSize: 15, fontWeight: '700', color: '#0C0F1A' },
  buyBtnBundlePrice:  { fontSize: 16, fontWeight: '800' },

  trust:              { padding: 24, gap: 6, marginTop: 8 },
  trustText:          { fontSize: 11, color: C.text3, textAlign: 'center', lineHeight: 18 },
});
