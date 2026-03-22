/**
 * PassportSnap-Bridging-Header.h
 *
 * Exposes Objective-C / React Native headers to Swift files in this target.
 * Xcode looks for this file via the build setting:
 *   SWIFT_OBJC_BRIDGING_HEADER = PassportSnap/PassportSnap-Bridging-Header.h
 *
 * If Xcode hasn't set that automatically (it does when you accept the
 * "Create Bridging Header" prompt), set it manually:
 *   Project → PassportSnap target → Build Settings → Swift Compiler →
 *   Objective-C Bridging Header
 *   Value: PassportSnap/PassportSnap-Bridging-Header.h
 */

#import <React/RCTBridgeModule.h>
#import <React/RCTLog.h>
