// Copyright 2019-2024 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

import AVFoundation
import Tauri
import UIKit

struct AudioConfig: Decodable {
  var sampleRate: UInt32?
  var channels: UInt32?
}

struct AudioDataPayload: Codable {
  var data: [Int16]
  var sampleRate: UInt32
  var channels: UInt32
}

class AudioBridgePlugin: Plugin {
  private var audioEngine: AVAudioEngine?
  private var inputNode: AVAudioInputNode?
  private var playerNode: AVAudioPlayerNode?
  private var isCapturing = false

  private var sampleRate: Double = 16000
  private var channels: UInt32 = 1

  public override func load(webview: WKWebView) {
    // Setup audio session for background audio
    setupAudioSession()
  }

  private func setupAudioSession() {
    let audioSession = AVAudioSession.sharedInstance()
    do {
      // Configure for playback and recording
      try audioSession.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth])
      try audioSession.setActive(true)

      print("[AudioBridge] Audio session configured successfully")
    } catch {
      print("[AudioBridge] Failed to setup audio session: \(error)")
    }
  }

  private func getPermissionState() -> String {
    switch AVAudioSession.sharedInstance().recordPermission {
    case .granted:
      return "granted"
    case .denied:
      return "denied"
    case .undetermined:
      return "prompt"
    @unknown default:
      return "prompt"
    }
  }

  @objc override func checkPermissions(_ invoke: Invoke) {
    let state = getPermissionState()
    invoke.resolve(["microphone": state])
  }

  @objc override func requestPermissions(_ invoke: Invoke) {
    let state = getPermissionState()

    if state == "prompt" {
      AVAudioSession.sharedInstance().requestRecordPermission { granted in
        invoke.resolve(["microphone": granted ? "granted" : "denied"])
      }
    } else {
      invoke.resolve(["microphone": state])
    }
  }

  @objc func startCapture(_ invoke: Invoke) throws {
    guard getPermissionState() == "granted" else {
      invoke.reject("Microphone permission not granted")
      return
    }

    let args = try invoke.parseArgs(AudioConfig.self)

    // Set configuration
    if let sr = args.sampleRate {
      self.sampleRate = Double(sr)
    }
    if let ch = args.channels {
      self.channels = ch
    }

    do {
      try startAudioCapture()
      invoke.resolve()
    } catch {
      invoke.reject("Failed to start audio capture: \(error.localizedDescription)")
    }
  }

  @objc func stopCapture(_ invoke: Invoke) {
    stopAudioCapture()
    invoke.resolve()
  }

  @objc func playAudio(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(AudioDataPayload.self)

    do {
      try playAudioData(data: args.data, sampleRate: args.sampleRate, channels: args.channels)
      invoke.resolve()
    } catch {
      invoke.reject("Failed to play audio: \(error.localizedDescription)")
    }
  }

  private func startAudioCapture() throws {
    // Stop any existing capture
    if isCapturing {
      stopAudioCapture()
    }

    // Create audio engine
    audioEngine = AVAudioEngine()
    guard let engine = audioEngine else {
      throw NSError(domain: "AudioBridge", code: -1, userInfo: [NSLocalizedDescriptionKey: "Failed to create audio engine"])
    }

    inputNode = engine.inputNode
    guard let input = inputNode else {
      throw NSError(domain: "AudioBridge", code: -1, userInfo: [NSLocalizedDescriptionKey: "No input node available"])
    }

    // Get the input format
    let inputFormat = input.outputFormat(forBus: 0)

    // Create desired format (16kHz mono PCM16)
    guard let desiredFormat = AVAudioFormat(
      commonFormat: .pcmFormatInt16,
      sampleRate: sampleRate,
      channels: AVAudioChannelCount(channels),
      interleaved: true
    ) else {
      throw NSError(domain: "AudioBridge", code: -1, userInfo: [NSLocalizedDescriptionKey: "Failed to create audio format"])
    }

    // Create converter if needed
    let converter = AVAudioConverter(from: inputFormat, to: desiredFormat)

    // Install tap on input node
    input.installTap(onBus: 0, bufferSize: 4096, format: inputFormat) { [weak self] (buffer, time) in
      guard let self = self, let converter = converter else { return }

      // Convert to desired format
      let capacity = AVAudioFrameCount(Double(buffer.frameLength) * self.sampleRate / inputFormat.sampleRate)
      guard let convertedBuffer = AVAudioPCMBuffer(pcmFormat: desiredFormat, frameCapacity: capacity) else {
        return
      }

      var error: NSError?
      let inputBlock: AVAudioConverterInputBlock = { inNumPackets, outStatus in
        outStatus.pointee = .haveData
        return buffer
      }

      converter.convert(to: convertedBuffer, error: &error, withInputFrom: inputBlock)

      if error != nil {
        print("[AudioBridge] Conversion error: \(error!)")
        return
      }

      // Extract PCM16 data
      if let channelData = convertedBuffer.int16ChannelData {
        let frameLength = Int(convertedBuffer.frameLength)
        let channelCount = Int(convertedBuffer.format.channelCount)
        var pcm16Data: [Int16] = []
        pcm16Data.reserveCapacity(frameLength * channelCount)

        for frame in 0..<frameLength {
          for channel in 0..<channelCount {
            pcm16Data.append(channelData[channel][frame])
          }
        }

        // Send audio data to frontend
        self.sendAudioData(pcm16Data)
      }
    }

    // Start the engine
    try engine.start()
    isCapturing = true

    print("[AudioBridge] Audio capture started (sampleRate: \(sampleRate), channels: \(channels))")
  }

  private func stopAudioCapture() {
    guard let engine = audioEngine, let input = inputNode else { return }

    input.removeTap(onBus: 0)
    engine.stop()

    audioEngine = nil
    inputNode = nil
    isCapturing = false

    print("[AudioBridge] Audio capture stopped")
  }

  private func playAudioData(data: [Int16], sampleRate: UInt32, channels: UInt32) throws {
    // Create audio format
    guard let format = AVAudioFormat(
      commonFormat: .pcmFormatInt16,
      sampleRate: Double(sampleRate),
      channels: AVAudioChannelCount(channels),
      interleaved: true
    ) else {
      throw NSError(domain: "AudioBridge", code: -1, userInfo: [NSLocalizedDescriptionKey: "Failed to create playback format"])
    }

    // Create buffer
    let frameCount = AVAudioFrameCount(data.count / Int(channels))
    guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount) else {
      throw NSError(domain: "AudioBridge", code: -1, userInfo: [NSLocalizedDescriptionKey: "Failed to create audio buffer"])
    }

    buffer.frameLength = frameCount

    // Copy data to buffer
    if let channelData = buffer.int16ChannelData {
      for frame in 0..<Int(frameCount) {
        for channel in 0..<Int(channels) {
          let index = frame * Int(channels) + channel
          channelData[channel][frame] = data[index]
        }
      }
    }

    // Create player node if needed
    if audioEngine == nil {
      audioEngine = AVAudioEngine()
      try audioEngine?.start()
    }

    if playerNode == nil {
      playerNode = AVAudioPlayerNode()
      audioEngine?.attach(playerNode!)
      audioEngine?.connect(playerNode!, to: audioEngine!.mainMixerNode, format: format)
    }

    // Play audio
    playerNode?.scheduleBuffer(buffer) {
      // Audio playback finished
      DispatchQueue.main.async {
        self.trigger("playbackFinished", data: [:])
      }
    }

    if !(playerNode?.isPlaying ?? false) {
      playerNode?.play()
    }
  }

  private func sendAudioData(_ data: [Int16]) {
    let payload: [String: Any] = [
      "data": data,
      "sampleRate": UInt32(sampleRate),
      "channels": channels
    ]

    trigger("audioData", data: payload)
  }
}

@_cdecl("init_plugin_audio_bridge")
func initPlugin() -> Plugin {
  return AudioBridgePlugin()
}
