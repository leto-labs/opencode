// Copyright 2019-2024 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

package app.tauri.audiobridge

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Log
import java.util.concurrent.atomic.AtomicBoolean

private const val TAG = "AudioRecorder"
private const val BUFFER_SIZE_FACTOR = 2

class AudioRecorder(
    private val sampleRate: Int = 16000,
    private val channels: Int = 1,
    private val onAudioData: (ShortArray) -> Unit
) {
    private var audioRecord: AudioRecord? = null
    private var recordingThread: Thread? = null
    private val isRecording = AtomicBoolean(false)

    private val channelConfig = if (channels == 1) {
        AudioFormat.CHANNEL_IN_MONO
    } else {
        AudioFormat.CHANNEL_IN_STEREO
    }

    private val bufferSize: Int by lazy {
        val minBufferSize = AudioRecord.getMinBufferSize(
            sampleRate,
            channelConfig,
            AudioFormat.ENCODING_PCM_16BIT
        )

        if (minBufferSize == AudioRecord.ERROR || minBufferSize == AudioRecord.ERROR_BAD_VALUE) {
            // Fallback buffer size: 4096 samples
            4096 * channels * 2
        } else {
            minBufferSize * BUFFER_SIZE_FACTOR
        }
    }

    fun start() {
        if (isRecording.get()) {
            Log.w(TAG, "Already recording")
            return
        }

        try {
            audioRecord = AudioRecord(
                MediaRecorder.AudioSource.MIC,
                sampleRate,
                channelConfig,
                AudioFormat.ENCODING_PCM_16BIT,
                bufferSize
            )

            if (audioRecord?.state != AudioRecord.STATE_INITIALIZED) {
                throw IllegalStateException("AudioRecord failed to initialize")
            }

            audioRecord?.startRecording()
            isRecording.set(true)

            recordingThread = Thread({
                recordingLoop()
            }, "AudioRecordThread").apply {
                priority = Thread.MAX_PRIORITY
                start()
            }

            Log.d(TAG, "Recording started (sampleRate: $sampleRate, channels: $channels, bufferSize: $bufferSize)")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start recording", e)
            stop()
            throw e
        }
    }

    private fun recordingLoop() {
        // Read buffer size in samples (not bytes)
        val readBufferSize = 4096
        val buffer = ShortArray(readBufferSize)

        while (isRecording.get()) {
            val readResult = audioRecord?.read(buffer, 0, readBufferSize) ?: -1

            when {
                readResult > 0 -> {
                    // Create a copy of the data we actually read
                    val audioData = if (readResult == readBufferSize) {
                        buffer.copyOf()
                    } else {
                        buffer.copyOf(readResult)
                    }
                    onAudioData(audioData)
                }
                readResult == AudioRecord.ERROR_INVALID_OPERATION -> {
                    Log.e(TAG, "AudioRecord read error: ERROR_INVALID_OPERATION")
                    break
                }
                readResult == AudioRecord.ERROR_BAD_VALUE -> {
                    Log.e(TAG, "AudioRecord read error: ERROR_BAD_VALUE")
                    break
                }
                readResult == AudioRecord.ERROR_DEAD_OBJECT -> {
                    Log.e(TAG, "AudioRecord read error: ERROR_DEAD_OBJECT")
                    break
                }
                readResult == AudioRecord.ERROR -> {
                    Log.e(TAG, "AudioRecord read error: ERROR")
                    break
                }
            }
        }

        Log.d(TAG, "Recording loop ended")
    }

    fun stop() {
        isRecording.set(false)

        recordingThread?.let { thread ->
            try {
                thread.join(1000) // Wait up to 1 second
                if (thread.isAlive) {
                    thread.interrupt()
                }
            } catch (e: InterruptedException) {
                Log.w(TAG, "Interrupted while waiting for recording thread to stop")
            }
            Unit
        }
        recordingThread = null

        audioRecord?.let { record ->
            try {
                if (record.recordingState == AudioRecord.RECORDSTATE_RECORDING) {
                    record.stop()
                }
                record.release()
            } catch (e: Exception) {
                Log.e(TAG, "Error stopping AudioRecord", e)
            }
        }
        audioRecord = null

        Log.d(TAG, "Recording stopped")
    }
}
