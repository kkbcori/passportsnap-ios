/**
 * PassportProcessorBridge.m
 *
 * Objective-C bridge that exposes the Swift PassportProcessor class to
 * React Native's bridge. This file must be compiled alongside the Swift
 * implementation; Xcode handles the Swift ↔ ObjC interop automatically
 * via the generated -Swift.h header.
 *
 * If Xcode reports "PassportProcessor not found", make sure:
 *   1. A Bridging Header exists in the project (Xcode creates one
 *      automatically when you add the first .swift file to an ObjC project).
 *   2. Both files are added to the PassportSnap target (not tests).
 */

#import <React/RCTBridgeModule.h>

RCT_EXTERN_MODULE(PassportProcessor, NSObject)

/**
 * prepare(photoUri, country) → Promise<{preparedUri, imageBase64, widthPx, heightPx, autoCrop}>
 */
RCT_EXTERN_METHOD(prepare:(NSString *)photoUri
                  country:(NSString *)country
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

/**
 * crop(base64, cropX, cropY, cropW, cropH, outW, outH, country, brightness)
 *   → Promise<{imageBase64, cleanBase64}>
 */
RCT_EXTERN_METHOD(crop:(NSString *)base64
                  cropX:(NSInteger)cropX
                  cropY:(NSInteger)cropY
                  cropW:(NSInteger)cropW
                  cropH:(NSInteger)cropH
                  outW:(NSInteger)outW
                  outH:(NSInteger)outH
                  country:(NSString *)country
                  brightness:(NSInteger)brightness
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

/**
 * makeSheet4x6(base64, country) → Promise<{imageBase64}>
 */
RCT_EXTERN_METHOD(makeSheet4x6:(NSString *)base64
                  country:(NSString *)country
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
