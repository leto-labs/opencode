// Copyright 2019-2024 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

package app.tauri.audiobridge

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.util.Log
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

private const val TAG = "AudioPlayer"

class AudioPlayer {
    private var audioTrack: AudioTrack? = null
    private val executor: ExecutorService = Executors.newSingleThreadExecutor()
    private var currentSampleRate: Int = 0
    private var currentChannels: Int = 0

    fun play(
        data: ShortArray,
        sampleRate: Int,
        channels: Int,
        onComplete: (() -> Unit)? = null
    ) {
        executor.execute {
            try {
                playInternal(data, sampleRate, channels)
                onComplete?.invoke()
            } catch (e: Exception) {
                Log.e(TAG, "Error playing audio", e)
                onComplete?.invoke()
            }
        }
    }

    private fun playInternal(data: ShortArray, sampleRate: Int, channels: Int) {
        // Recreate AudioTrack if format changed
        if (audioTrack == null || currentSampleRate != sampleRate || currentChannels != channels) {
            releaseTrack()
            currentSampleRate = sampleRate
            currentChannels = channels

            val channelConfig = if (channels == 1) {
                AudioFormat.CHANNEL_OUT_MONO
            } else {
                AudioFormat.CHANNEL_OUT_STEREO
            }

            val bufferSize = AudioTrack.getMinBufferSize(
                sampleRate,
                channelConfig,
                AudioFormat.ENCODING_PCM_16BIT
            )

            val audioAttributes = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build()

            val audioFormat = AudioFormat.Builder()
                .setSampleRate(sampleRate)
                .setChannelMask(channelConfig)
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .build()

            audioTrack = AudioTrack(
                audioAttributes,
                audioFormat,
                maxOf(bufferSize, data.size * 2), // Ensure buffer can hold the data
                AudioTrack.MODE_STREAM,
                android.media.AudioManager.AUDIO_SESSION_ID_GENERATE
            )

            if (audioTrack?.state != AudioTrack.STATE_INITIALIZED) {
                Log.e(TAG, "AudioTrack failed to initialize")
                audioTrack = null
                return
            }

            Log.d(TAG, "AudioTrack created (sampleRate: $sampleRate, channels: $channels)")
        }

        audioTrack?.let { track ->
            try {
                if (track.playState != AudioTrack.PLAYSTATE_PLAYING) {
                    track.play()
                }

                val written = track.write(data, 0, data.size)
                if (written < 0) {
                    Log.e(TAG, "AudioTrack write error: $written")
                } else {
                    Log.d(TAG, "Wrote $written samples to AudioTrack")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error writing to AudioTrack", e)
            }
        }
    }

    private fun releaseTrack() {
        audioTrack?.let { track ->
            try {
                if (track.playState == AudioTrack.PLAYSTATE_PLAYING) {
                    track.stop()
                }
                track.release()
            } catch (e: Exception) {
                Log.e(TAG, "Error releasing AudioTrack", e)
            }
        }
        audioTrack = null
    }

    fun release() {
        executor.shutdown()
        releaseTrack()
        Log.d(TAG, "AudioPlayer released")
    }
}
