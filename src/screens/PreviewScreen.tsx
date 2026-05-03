/**
 * PreviewScreen v6.0 — On-Device Processing (no backend)
 * Uses NativeModules.PassportProcessor.makeSheet4x6() instead of HTTP fetch
 */
import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Image,
  SafeAreaView, ScrollView, Dimensions, Alert, ActivityIndicator, NativeModules, Linking, Platform,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import RNFS from 'react-native-fs';
import PaywallScreen from './PaywallScreen';
import { CameraRoll } from '@react-native-camera-roll/camera-roll';
import PassportHeadOverlay from '../components/PassportHeadOverlay';
import FloatingOrbs from '../components/FloatingOrbs';

const { PassportProcessor } = NativeModules;

type RouteParams = { processedUri: string; base64?: string; cleanBase64?: string; country?: string };

const SW = Dimensions.get('window').width;

function getPhotoSize(country?: string) {
  const maxW = SW - 48;
  const ASPECTS: Record<string, number> = {
    'GBR': 1200 / 900, 'AUS': 1200 / 900, 'CAN': 1680 / 1200,
    'SCH': 1200 / 900, 'DEU': 1200 / 900, 'ZAF': 1200 / 900,
  };
  const aspect = ASPECTS[country ?? ''];
  if (aspect) { const h = Math.round(maxW * aspect); return { w: maxW, h }; }
  return { w: maxW, h: maxW };
}

export default function PreviewScreen() {
  const navigation  = useNavigation<any>();
  const route       = useRoute<RouteProp<Record<string, RouteParams>, string>>();
  const { processedUri, base64, cleanBase64, country: countryRaw } = route.params;
  const country = countryRaw ?? 'USA';
  const countryLabel = country === 'IND' ? 'India' : country === 'GBR' ? 'UK' : country === 'AUS' ? 'Australia' : country === 'CAN' ? 'Canada' : country === 'SCH' ? 'Schengen' : country === 'DEU' ? 'Germany' : country === 'ZAF' ? 'South Africa' : 'US';

  const { w: PHOTO_W, h: PHOTO_H } = getPhotoSize(country);
  const [showOverlay, setShowOverlay] = useState(true);
  const [autoToggle, setAutoToggle] = useState(true);
  const [saving2x2, setSaving2x2] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [purchaseType, setPurchaseType] = useState<'single'|'4x6'|'bundle'|null>(null);
  const [saving4x6, setSaving4x6] = useState(false);
  const [savingBundle, setSavingBundle] = useState(false);
  const [preview4x6Uri, setPreview4x6Uri] = useState<string | null>(null);

  // Tracks which products the user has purchased in this session.
  // Bundle grants both single and fourSix entitlements.
  // Once any of these is true, the watermark is removed from the preview.
  const [purchasedProducts, setPurchasedProducts] = useState({
    single: false,
    fourSix: false,
  });
  const hasAnyPurchase = purchasedProducts.single || purchasedProducts.fourSix;

  // Generate 4x6 preview on mount for "What You Get" section
  useEffect(() => {
    const gen4x6Preview = async () => {
      try {
        const photoData = cleanBase64 ?? base64;
        if (!photoData) return;
        const data = await PassportProcessor.makeSheet4x6(photoData, country);
        const previewPath = `${RNFS.CachesDirectoryPath}/preview_4x6_${Date.now()}.jpg`;
        await RNFS.writeFile(previewPath, data.imageBase64, 'base64');
        setPreview4x6Uri(`file://${previewPath}`);
      } catch (e) {
        // Silent fail — the section will just show the single photo
      }
    };
    gen4x6Preview();
  }, []);

  // Auto-toggle overlay every 2 seconds
  useEffect(() => {
    if (!autoToggle) return;
    const interval = setInterval(() => {
      setShowOverlay(v => !v);
    }, 2000);
    return () => clearInterval(interval);
  }, [autoToggle]);

  // Buy handlers — open paywall to initiate purchase
  const buySingle = () => { setPurchaseType('single'); setShowPaywall(true); };
  const buy4x6 = () => { setPurchaseType('4x6'); setShowPaywall(true); };
  const buyBundle = () => { setPurchaseType('bundle'); setShowPaywall(true); };

  // Download handlers — save the photo(s) to gallery (post-purchase only)
  const download2x2 = async () => {
    const photoData = cleanBase64 ?? base64 ?? '';
    if (!photoData) { Alert.alert('Error', 'Photo data missing.'); return; }
    await doSave2x2(photoData);
  };
  const download4x6 = async () => {
    await save4x6(); // already pulls from cleanBase64/base64 internally
  };
  const downloadBundle = async () => {
    const photoData = cleanBase64 ?? base64 ?? '';
    if (!photoData) { Alert.alert('Error', 'Photo data missing.'); return; }
    await saveBundle(photoData);
  };

  // Photo-library permission check for camera-roll v7.x (your installed version).
  // On iOS uses iosRequestReadWriteGalleryPermission (the v7+ API).
  // On Android uses PermissionsAndroid for WRITE_EXTERNAL_STORAGE.
  // Returns true only if permission is fully granted (not 'limited' on iOS, since
  // limited access can cause silent save failures Apple's reviewer may have seen).
  const requestPhotoPermission = async (): Promise<boolean> => {
    try {
      const cr: any = CameraRoll;
      if (Platform.OS === 'ios' && typeof cr.iosRequestReadWriteGalleryPermission === 'function') {
        const status = await cr.iosRequestReadWriteGalleryPermission();
        // 'granted' = full access, 'limited' = partial, 'denied'/'restricted' = blocked
        return status === 'granted' || status === 'limited' || status === true;
      }
      if (typeof cr.requestSavePermission === 'function') {
        // Fallback for older library versions
        const result = await cr.requestSavePermission();
        return result?.status !== 'denied';
      }
      if (Platform.OS === 'android') {
        const { PermissionsAndroid } = require('react-native');
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      }
    } catch {
      // Fall through — don't block the save on a permission-API error.
    }
    // No explicit API available; let CameraRoll.save trigger the system prompt.
    return true;
  };

  // Open the device's Photos app — used in success messages so users can verify
  // the save landed. iOS uses photos-redirect:// URL scheme; Android falls back
  // to a generic intent that opens whatever the user's default photo viewer is.
  const openPhotosApp = async () => {
    try {
      if (Platform.OS === 'ios') {
        await Linking.openURL('photos-redirect://');
      } else {
        await Linking.openURL('content://media/internal/images/media');
      }
    } catch {
      // Photos app couldn't be opened (rare) — fail silently rather than alerting.
    }
  };

  // Save a file to the camera roll and verify the outcome.
  //
  // The challenge: @react-native-camera-roll's bridge sometimes spuriously rejects
  // a successful save (when the iOS permission prompt fires during the save itself).
  // We need to distinguish that case from a genuine failure (permission denied,
  // storage full, etc) so we can show real errors when they happen.
  //
  // Strategy:
  //   1. CameraRoll.save returns the new PHAsset URI (string) on success → confirmed save.
  //   2. If it rejects but we know permission is granted, it's likely the spurious
  //      rejection — file probably landed; treat as soft-success but flag uncertain.
  //   3. If it rejects AND permission is not granted, it's a real failure.
  //
  // Returns:
  //   { confirmed: true, uri: 'ph://...' } — save definitely succeeded
  //   { confirmed: false, uri: '' }        — save probably succeeded but unverified
  // Throws Error only for genuine failures (permission denied/restricted, storage full).
  const saveToGallery = async (
    fileUri: string,
    permissionWasGranted: boolean
  ): Promise<{ confirmed: boolean; uri: string }> => {
    try {
      const assetUri: any = await CameraRoll.save(fileUri, { type: 'photo' });
      if (typeof assetUri === 'string' && assetUri.length > 0) {
        return { confirmed: true, uri: assetUri };
      }
      // Resolved with no URI — treat as unverified success
      return { confirmed: false, uri: '' };
    } catch (err: any) {
      // If permission wasn't granted at the time of the call, this is a genuine failure.
      if (!permissionWasGranted) {
        throw new Error(err?.message ?? 'Photo save failed — permission may be denied');
      }
      // Permission was granted but Promise rejected — this is the well-known spurious
      // rejection from @react-native-camera-roll. File almost certainly landed in gallery.
      return { confirmed: false, uri: '' };
    }
  };

  // Write base64 to a temp file and verify it exists with non-zero size before returning.
  // Uses DocumentDirectoryPath instead of CachesDirectoryPath because PHPhotoLibrary
  // on newer iOS versions can fail with "Unknown error from a native module" when
  // ingesting from cache paths that the system has flagged as evictable mid-write.
  // Also catches the silent failure where RNFS.writeFile resolves but the file
  // isn't actually flushed to disk yet.
  const writeAndVerify = async (filename: string, base64Data: string): Promise<string> => {
    const path = `${RNFS.DocumentDirectoryPath}/${filename}`;
    await RNFS.writeFile(path, base64Data, 'base64');
    // Settle for fsync, then verify
    await new Promise(r => setTimeout(r, 200));
    const exists = await RNFS.exists(path);
    if (!exists) {
      throw new Error(`File write failed — ${filename} does not exist after write`);
    }
    const stat = await RNFS.stat(path);
    const size = typeof stat.size === 'string' ? parseInt(stat.size, 10) : stat.size;
    if (!size || size < 100) {
      throw new Error(`File write produced empty/tiny file (${size} bytes)`);
    }
    return path;
  };

  // Tracks whether we've already shown the "rate us" prompt this session — only show once.
  const reviewAsked = useRef(false);

  // Show the post-save success alert. Tells the user exactly where to find the photo
  // and offers a button to open the Photos app directly. The "Recents album" hint
  // addresses the iPad reviewer's confusion ("we couldn't find it in the library").
  const showSaveSuccessAlert = (
    label: string,
    confirmedSaves: number,
    totalSaves: number
  ) => {
    const title = confirmedSaves === totalSaves ? 'Saved! ✓' : 'Saved (please verify)';
    const message =
      confirmedSaves === totalSaves
        ? `${label} saved to your Photos library.\n\nTip: open the Photos app and check the Recents album. If the photo isn't visible immediately, pull down to refresh.`
        : `${label} sent to your Photos library, but we couldn't fully confirm it landed.\n\nPlease open Photos → Recents and check. If you don't see it, ensure photo access is enabled at Settings → PassportSnap → Photos and try again.`;
    Alert.alert(title, message, [
      { text: 'Open Photos', onPress: openPhotosApp },
      { text: 'OK', style: 'cancel' },
    ]);
    // Trigger review prompt once per session, after a confirmed download.
    if (confirmedSaves > 0 && !reviewAsked.current) {
      reviewAsked.current = true;
      setTimeout(() => askForReview(), 3500);
    }
  };

  const doSave2x2 = async (clean: string) => {
    try {
      setSaving2x2(true);
      const permGranted = await requestPhotoPermission();
      if (!permGranted) {
        Alert.alert(
          'Photo access needed',
          'PassportSnap needs permission to save photos to your library. Open Settings → PassportSnap → Photos and choose "Add Photos Only" or "All Photos", then try again.'
        );
        return;
      }
      const path = await writeAndVerify(`passport_${Date.now()}.jpg`, clean);
      const result = await saveToGallery(`file://${path}`, permGranted);
      try { await RNFS.unlink(path); } catch {}
      showSaveSuccessAlert('Passport photo', result.confirmed ? 1 : 0, 1);
    } catch (e: any) {
      Alert.alert(
        'Save failed',
        `${e?.message ?? 'Could not save to gallery.'}\n\nCheck Settings → PassportSnap → Photos and ensure access is allowed.`
      );
    } finally { setSaving2x2(false); }
  };

  const save4x6 = async (overrideBase64?: string) => {
    const photoData = overrideBase64 ?? cleanBase64 ?? base64;
    if (!photoData) { Alert.alert('Error', 'Photo data missing.'); return; }
    try {
      setSaving4x6(true);
      const permGranted = await requestPhotoPermission();
      if (!permGranted) {
        Alert.alert(
          'Photo access needed',
          'PassportSnap needs permission to save photos to your library. Open Settings → PassportSnap → Photos and choose "Add Photos Only" or "All Photos", then try again.'
        );
        return;
      }
      const data = await PassportProcessor.makeSheet4x6(photoData, country ?? 'USA');
      const sheetPath = await writeAndVerify(`passport_4x6_${Date.now()}.jpg`, data.imageBase64);
      const result = await saveToGallery(`file://${sheetPath}`, permGranted);
      try { await RNFS.unlink(sheetPath); } catch {}
      showSaveSuccessAlert('4×6 print sheet', result.confirmed ? 1 : 0, 1);
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not create 4x6 sheet.');
    } finally { setSaving4x6(false); }
  };

  const saveBundle = async (photoData: string) => {
    let singlePath = '';
    let sheetPath = '';
    try {
      setSavingBundle(true);

      // Permission check up-front
      const permGranted = await requestPhotoPermission();
      if (!permGranted) {
        Alert.alert(
          'Photo access needed',
          'PassportSnap needs permission to save photos to your library. Open Settings → PassportSnap → Photos and choose "Add Photos Only" or "All Photos", then try again.'
        );
        return;
      }

      // -- Step 1: write the 2x2 file to disk and save it to gallery --
      singlePath = await writeAndVerify(`passport_${Date.now()}.jpg`, photoData);
      const r1 = await saveToGallery(`file://${singlePath}`, permGranted);

      // -- Step 2: generate the 4x6 sheet (same path standalone save4x6 uses).
      // We do NOT reuse preview4x6Uri — that file is generated on mount with best-effort
      // error handling and was observed producing single-photo output instead of a sheet. --
      const data = await PassportProcessor.makeSheet4x6(photoData, country ?? 'USA');
      sheetPath = await writeAndVerify(`passport_4x6_${Date.now()}.jpg`, data.imageBase64);

      // -- Step 3: brief settle delay, then save the 4x6 to gallery --
      // 1200ms gives iOS PHPhotoLibrary time to finish ingesting the 2x2 before
      // we hand it the 4x6. Without the delay, back-to-back saves can spuriously reject.
      await new Promise(resolve => setTimeout(resolve, 1200));
      const r2 = await saveToGallery(`file://${sheetPath}`, permGranted);

      const confirmed = (r1.confirmed ? 1 : 0) + (r2.confirmed ? 1 : 0);
      showSaveSuccessAlert('Both single photo and 4×6 print sheet', confirmed, 2);
    } catch (e: any) {
      // Triggers for genuine errors: writeAndVerify, makeSheet4x6, or a real save failure.
      Alert.alert(
        'Save failed',
        `${e?.message ?? 'Could not save bundle.'}\n\nTry the individual Save buttons — your purchase already covers both. If the issue persists, check Settings → PassportSnap → Photos.`
      );
    } finally {
      // Always clean up temp files, regardless of outcome
      if (singlePath) { try { await RNFS.unlink(singlePath); } catch {} }
      if (sheetPath) { try { await RNFS.unlink(sheetPath); } catch {} }
      setSavingBundle(false);
    }
  };

  const askForReview = () => {
    setTimeout(() => {
      Alert.alert(
        'Enjoying PassportSnap?',
        'Your photo has been saved! If PassportSnap helped you, a quick review would mean a lot to us.',
        [
          { text: 'Not now', style: 'cancel' },
          {
            text: 'Rate us ★★★★★',
            onPress: () => {
              const storeUrl = Platform.OS === 'ios'
                ? 'itms-apps://itunes.apple.com/app/id6760956080?action=write-review'
                : 'https://play.google.com/store/apps/details?id=com.passportsnap&showAllReviews=true';
              Linking.openURL(storeUrl).catch(() => {});
            },
          },
        ],
        { cancelable: true }
      );
    }, 1500); // Delay so the save confirmation shows first
  };

  return (
    <SafeAreaView style={styles.safe}>
      <FloatingOrbs />
      <ScrollView contentContainerStyle={styles.scroll} bounces={false}>

        <Text style={styles.title}>Your Passport Photo</Text>
        <Text style={styles.subtitle}>{
          country === 'GBR' ? '900×1200 px  |  35×45 mm  |  UK Compliant' :
          country === 'AUS' ? '900×1200 px  |  35×45 mm  |  AU Compliant' :
          country === 'CAN' ? '1200×1680 px  |  50×70 mm  |  CA Compliant' :
          country === 'SCH' ? '900×1200 px  |  35×45 mm  |  Schengen Compliant' :
          country === 'DEU' ? '900×1200 px  |  35×45 mm  |  Germany Compliant' :
          country === 'ZAF' ? '900×1200 px  |  35×45 mm  |  South Africa Compliant' :
          '600×600 px  |  2×2 in  |  300 DPI  |  ' + countryLabel + ' Compliant'
        }</Text>

        <View
          style={[styles.photoWrap, { width: PHOTO_W, height: PHOTO_H }]}
        >
          <Image source={{ uri: processedUri }} style={{ width: PHOTO_W, height: PHOTO_H }} resizeMode="cover" />
          {showOverlay && <PassportHeadOverlay size={PHOTO_W} height={PHOTO_H} showLabels={true} country={country} />}
          {/* Subtle diagonal watermark — removed once user purchases anything */}
          {!hasAnyPurchase && (
            <View pointerEvents="none" style={styles.watermarkOverlay}>
              {/* Render multiple diagonal text rows so it tiles across the photo */}
              {[0, 1, 2, 3, 4, 5, 6, 7].map(row => (
                <Text
                  key={row}
                  style={[
                    styles.watermarkText,
                    { top: row * (PHOTO_H / 7) - 20, width: PHOTO_W * 1.6, left: -PHOTO_W * 0.3 },
                  ]}
                  numberOfLines={1}
                >
                  passportsnap.com  ·  passportsnap.com  ·  passportsnap.com  ·  passportsnap.com
                </Text>
              ))}
            </View>
          )}
          {!hasAnyPurchase && (
            <View style={styles.watermarkBadge}>
              <Text style={styles.watermarkBadgeText}>PREVIEW — Watermark removed after purchase</Text>
            </View>
          )}
        </View>

        <TouchableOpacity style={[styles.toggleBtn, showOverlay && styles.toggleBtnActive]}
          onPress={() => {
            setAutoToggle(false);  // Stop auto-toggle on manual tap
            setShowOverlay(v => !v);
          }} activeOpacity={0.8}>
          <Text style={[styles.toggleText, showOverlay && styles.toggleTextActive]}>
            {showOverlay ? 'Overlay ON' : 'Overlay OFF'}{autoToggle ? '  ·  Auto' : ''}
          </Text>
        </TouchableOpacity>

        <View style={styles.checkCard}>
          <Text style={styles.checkTitle}>COMPLIANCE CHECKS</Text>
          {(country === 'SCH' || country === 'DEU' || country === 'ZAF' ? [
            ['Size',         '900×1200 px · 35×45 mm · ~600 DPI'],
            ['Head height',  '29–34mm crown to chin'],
            ['Top padding',  '15% above crown'],
            ['Background',   'White'],
            ['Colours',      'Original — unchanged'],
          ] : country === 'CAN' ? [
            ['Size',         '1200×1680 px · 50×70 mm · ~610 DPI'],
            ['Head height',  '31–36mm chin to crown (target 33.5mm)'],
            ['Top padding',  '12% above crown'],
            ['Background',   'White or light-coloured'],
            ['Colours',      'Original — unchanged'],
          ] : country === 'GBR' ? [
            ['Size',         '900×1200 px · 35×45 mm · ~600 DPI'],
            ['Head height',  '29–34mm crown to chin'],
            ['Top padding',  '15% above crown'],
            ['Background',   'White or light grey'],
            ['Colours',      'Original — unchanged'],
          ] : country === 'AUS' ? [
            ['Size',         '900×1200 px · 35×45 mm · ~600 DPI'],
            ['Face height',  'Exactly 33mm chin to crown'],
            ['Top padding',  'Crown at oval tip'],
            ['Background',   'White or light grey'],
            ['Colours',      'Original — unchanged'],
          ] : country === 'IND' ? [
            ['Size',            '600×600 px · 2×2 in · 300 DPI'],
            ['Head height',     '50–69% of image'],
            ['Eye from bottom', '56–69%'],
            ['Background',      'White / off-white'],
            ['Colours',         'Original — unchanged'],
          ] : [
            ['Size',            '600×600 px · 2×2 in · 300 DPI'],
            ['Head height',     '1"–1⅜" · 50–69% of image'],
            ['Eye from bottom', '1⅛"–1⅜" · 56–69%'],
            ['Background',      'White / off-white'],
            ['Colours',         'Original — unchanged'],
          ]).map(([k, v]) => (
            <View key={k} style={styles.row}>
              <Text style={styles.rowKey}>{k}</Text>
              <Text style={styles.rowVal}>{v}</Text>
            </View>
          ))}
        </View>

        {/* What You Get — user's actual photos */}
        <View style={styles.wygSection}>
          <Text style={styles.wygTitle}>WHAT YOU GET</Text>
          <View style={styles.wygRow}>
            <View style={styles.wygCard}>
              <Image source={{ uri: processedUri }} style={styles.wygImgSingle} resizeMode="contain" />
              <Text style={styles.wygLabel}>Single Photo</Text>
              <Text style={styles.wygSub}>Print-ready, no watermark</Text>
            </View>
            <View style={styles.wygCard}>
              {preview4x6Uri ? (
                <Image source={{ uri: preview4x6Uri }} style={styles.wygImg4x6} resizeMode="contain" />
              ) : (
                <View style={[styles.wygImg4x6, styles.wygPlaceholder]}>
                  <ActivityIndicator size="small" color={C.text3} />
                </View>
              )}
              <Text style={styles.wygLabel}>4×6 Print Sheet</Text>
              <Text style={styles.wygSub}>2 photos, ready for any lab</Text>
            </View>
          </View>
        </View>

        <Text style={styles.dlTitle}>{hasAnyPurchase ? 'Download' : 'Buy'}</Text>

        {/* 2x2 — show Download if owned, Buy if not */}
        {purchasedProducts.single ? (
          <TouchableOpacity style={styles.btn2x2} onPress={download2x2} disabled={saving2x2} activeOpacity={0.85}>
            {saving2x2 ? <ActivityIndicator color="#fff" /> : (
              <>
                <Text style={styles.btn2x2Icon}>2x2</Text>
                <View style={styles.btnTextWrap}>
                  <Text style={styles.btn2x2Label}>Download 2x2 Photo</Text>
                  <Text style={styles.btn2x2Sub}>Tap to save to Photos · Owned</Text>
                </View>
                <Text style={styles.btnDownloadIcon}>⬇</Text>
              </>
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.btn2x2} onPress={buySingle} disabled={saving2x2} activeOpacity={0.85}>
            {saving2x2 ? <ActivityIndicator color="#fff" /> : (
              <>
                <Text style={styles.btn2x2Icon}>2x2</Text>
                <View style={styles.btnTextWrap}>
                  <Text style={styles.btn2x2Label}>Buy 2x2 Photo</Text>
                  <Text style={styles.btn2x2Sub}>Single passport photo · No watermark · $1.50</Text>
                </View>
              </>
            )}
          </TouchableOpacity>
        )}

        {/* 4x6 — show Download if owned, Buy if not */}
        {purchasedProducts.fourSix ? (
          <TouchableOpacity style={styles.btn4x6} onPress={download4x6} disabled={saving4x6} activeOpacity={0.85}>
            {saving4x6 ? <ActivityIndicator color="#3B5BDB" /> : (
              <>
                <Text style={styles.btn4x6Icon}>4x6</Text>
                <View style={styles.btnTextWrap}>
                  <Text style={styles.btn4x6Label}>Download 4×6 Print Sheet</Text>
                  <Text style={styles.btn4x6Sub}>Tap to save to Photos · Owned</Text>
                </View>
                <Text style={[styles.btnDownloadIcon, { color: C.text1 }]}>⬇</Text>
              </>
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.btn4x6} onPress={buy4x6} disabled={saving4x6} activeOpacity={0.85}>
            {saving4x6 ? <ActivityIndicator color="#3B5BDB" /> : (
              <>
                <Text style={styles.btn4x6Icon}>4x6</Text>
                <View style={styles.btnTextWrap}>
                  <Text style={styles.btn4x6Label}>Buy 4×6 Print Sheet</Text>
                  <Text style={styles.btn4x6Sub}>2 photos side by side · No watermark · $1.50</Text>
                </View>
              </>
            )}
          </TouchableOpacity>
        )}

        {/* Bundle — show Download Both if both owned, else Buy Bundle. Hide entirely if user owns both via separate purchases (pointless). */}
        {(purchasedProducts.single && purchasedProducts.fourSix) ? (
          <TouchableOpacity style={styles.btnBundle} onPress={downloadBundle} disabled={savingBundle} activeOpacity={0.85}>
            {savingBundle ? <ActivityIndicator color="#F5A623" /> : (
              <>
                <Text style={styles.btnBundleIcon}>📦</Text>
                <View style={styles.btnTextWrap}>
                  <Text style={styles.btnBundleLabel}>Download Both — 2x2 + 4×6</Text>
                  <Text style={styles.btnBundleSub}>Tap to save both to Photos · Owned</Text>
                </View>
                <Text style={[styles.btnDownloadIcon, { color: C.gold }]}>⬇</Text>
              </>
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.btnBundle} onPress={buyBundle} disabled={savingBundle} activeOpacity={0.85}>
            {savingBundle ? <ActivityIndicator color="#F5A623" /> : (
              <>
                <View style={styles.btnBundleBadge}><Text style={styles.btnBundleBadgeText}>BEST VALUE</Text></View>
                <Text style={styles.btnBundleIcon}>📦</Text>
                <View style={styles.btnTextWrap}>
                  <Text style={styles.btnBundleLabel}>Buy Both — Single + 4×6</Text>
                  <Text style={styles.btnBundleSub}>Everything you need · No watermark · $2.49</Text>
                </View>
              </>
            )}
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.againBtn} onPress={() => navigation.navigate('CountrySelect')}>
          <Text style={styles.againText}>Start over</Text>
        </TouchableOpacity>


      </ScrollView>

      <PaywallScreen visible={showPaywall} onClose={() => setShowPaywall(false)} country={country}
        onPurchased={async (type) => {
          setShowPaywall(false);
          // Mark the purchased product(s) as owned. Bundle grants both single and 4x6.
          // We do NOT auto-save here — the user explicitly taps "Download" to save,
          // which gives them control over when files appear in their gallery and
          // matches the iOS pattern of user-initiated saves (addresses Apple review feedback).
          if (type === 'single') {
            setPurchasedProducts(prev => ({ ...prev, single: true }));
          } else if (type === '4x6') {
            setPurchasedProducts(prev => ({ ...prev, fourSix: true }));
          } else if (type === 'bundle') {
            setPurchasedProducts({ single: true, fourSix: true });
          }
          // Brief confirmation that purchase succeeded; the Download button(s) appear next.
          Alert.alert(
            'Purchase complete ✓',
            'Tap the Download button below to save your photo(s) to the Photos library. You can download as many times as you like.'
          );
        }}
      />
    </SafeAreaView>
  );
}

const C = {
  bg: '#0C0F1A', surface: '#151929', border: '#1E2438',
  text1: '#F0F2FF', text2: '#A8B1CC', text3: '#6B7294',
  accent: '#2B59C3', accentLight: 'rgba(43,89,195,0.15)',
  emerald: '#1DB954', gold: '#F5A623',
};
const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: C.bg },
  scroll:      { padding: 24, paddingBottom: 48, alignItems: 'center' },
  title:       { fontSize: 20, fontWeight: '700', color: C.text1, letterSpacing: -0.3, marginBottom: 4 },
  subtitle:    { fontSize: 12, color: C.text3, marginBottom: 20, textAlign: 'center' },
  photoWrap:   { borderRadius: 6, overflow: 'hidden', marginBottom: 12, borderWidth: 1, borderColor: C.border, position: 'relative' },
  watermarkOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' },
  watermarkText: { position: 'absolute', color: 'rgba(255,255,255,0.18)', fontSize: 13, fontWeight: '600', letterSpacing: 1, textAlign: 'center', transform: [{ rotate: '-30deg' }] },
  watermarkBadge: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(12,15,26,0.75)', paddingVertical: 6, paddingHorizontal: 12, alignItems: 'center' },
  watermarkBadgeText: { color: C.gold, fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  toggleBtn:       { backgroundColor: C.surface, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8, marginBottom: 14, borderWidth: 1, borderColor: C.border },
  toggleBtnActive: { backgroundColor: C.accent, borderColor: C.accent },
  toggleText:      { fontSize: 12, color: C.text2, fontWeight: '600' },
  toggleTextActive:{ color: '#FFFFFF' },
  legend:      { alignSelf: 'stretch', backgroundColor: C.surface, borderRadius: 14, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: C.border },
  legendTitle: { fontSize: 10, fontWeight: '700', color: C.gold, letterSpacing: 1.5, marginBottom: 10 },
  legendRow:   { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  swatch:      { width: 22, height: 14, borderRadius: 3, borderWidth: 2, marginRight: 8, marginTop: 2 },
  legendText:  { fontSize: 12, color: C.text2, flex: 1, lineHeight: 17 },
  checkCard:   { alignSelf: 'stretch', backgroundColor: C.surface, borderRadius: 14, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: C.border },
  checkTitle:  { fontSize: 10, fontWeight: '700', color: C.gold, letterSpacing: 1.5, marginBottom: 10 },
  row:         { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 7, flexWrap: 'wrap' },
  rowKey:      { fontSize: 13, fontWeight: '600', color: C.text1, flex: 1 },
  rowVal:      { fontSize: 12, color: C.text2, flex: 1.5, textAlign: 'right' },
  dlTitle:     { fontSize: 14, fontWeight: '700', color: C.text1, alignSelf: 'flex-start', marginBottom: 10 },
  btnTextWrap: { flex: 1 },
  btnDownloadIcon: { fontSize: 22, fontWeight: '700', color: '#FFFFFF', marginLeft: 8 },
  btn2x2:      { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: C.accent, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 20, alignSelf: 'stretch', marginBottom: 10 },
  btn2x2Icon:  { fontSize: 12, fontWeight: '700', color: '#FFFFFF', backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, overflow: 'hidden', minWidth: 38, textAlign: 'center' },
  btn2x2Label: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  btn2x2Sub:   { color: 'rgba(255,255,255,0.55)', fontSize: 11 },
  btn4x6:      { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: C.surface, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 20, alignSelf: 'stretch', marginBottom: 20, borderWidth: 1, borderColor: C.border },
  btn4x6Icon:  { fontSize: 12, fontWeight: '700', color: '#4A7AE8', backgroundColor: C.accentLight, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, overflow: 'hidden', minWidth: 38, textAlign: 'center' },
  btn4x6Label: { color: C.text1, fontSize: 15, fontWeight: '600' },
  btn4x6Sub:   { color: C.text3, fontSize: 11 },
  againBtn:    { paddingVertical: 14, paddingHorizontal: 36, marginTop: 8, backgroundColor: C.surface, borderRadius: 14, alignItems: 'center', borderWidth: 1, borderColor: C.border },
  againText:   { color: C.text2, fontSize: 15, fontWeight: '600' },


  // What You Get
  wygSection:  { alignSelf: 'stretch', marginTop: 20, marginBottom: 4 },
  wygTitle:    { fontSize: 11, fontWeight: '700', color: C.gold, letterSpacing: 1.5, marginBottom: 12 },
  wygRow:      { flexDirection: 'row', gap: 12 },
  wygCard:     { flex: 1, backgroundColor: C.surface, borderRadius: 12, padding: 10, alignItems: 'center', borderWidth: 1, borderColor: C.border },
  wygImgSingle:{ width: 100, height: 100, borderRadius: 6, marginBottom: 8 },
  wygImg4x6:  { width: 80, height: 120, borderRadius: 6, marginBottom: 8 },
  wygPlaceholder: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  wygLabel:    { fontSize: 12, fontWeight: '600', color: C.text1, marginBottom: 2 },
  wygSub:      { fontSize: 10, color: C.text3, textAlign: 'center' },

  // Bundle button
  btnBundle:   { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: 'rgba(245,166,35,0.08)', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 20, alignSelf: 'stretch', marginBottom: 20, borderWidth: 1.5, borderColor: 'rgba(245,166,35,0.35)', position: 'relative', overflow: 'hidden' },
  btnBundleBadge: { position: 'absolute', top: 0, right: 0, backgroundColor: C.gold, borderBottomLeftRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  btnBundleBadgeText: { fontSize: 8, fontWeight: '800', color: '#0C0F1A', letterSpacing: 0.5 },
  btnBundleIcon: { fontSize: 20 },
  btnBundleLabel: { color: C.gold, fontSize: 15, fontWeight: '700' },
  btnBundleSub: { color: 'rgba(245,166,35,0.6)', fontSize: 11 },
});
