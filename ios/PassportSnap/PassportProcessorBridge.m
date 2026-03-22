/**
 * PassportProcessorBridge.m
 * Exposes the Swift PassportProcessor class to React Native's JS bridge.
 *
 * RCT_EXTERN_MODULE must be used as the class name inside @interface / @end.
 * RCT_EXTERN_METHOD declarations go between @interface and @end.
 */

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(PassportProcessor, NSObject)

RCT_EXTERN_METHOD(prepare:(NSString *)photoUri
                  country:(NSString *)country
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

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

RCT_EXTERN_METHOD(makeSheet4x6:(NSString *)base64
                  country:(NSString *)country
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

@end
