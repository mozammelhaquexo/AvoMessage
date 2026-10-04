/**
 * components/voice — voice message recording & playback.
 *
 * VoiceRecorder (alias VoiceRecorderView): hold/tap-to-record → preview →
 * upload → onSend(upload, durationMs). The parent creates the VOICE message.
 *
 * AudioPlayer: play/pause, seek (pointer + keyboard), duration, mini
 * waveform, speed control. Drop into MessageBubble for VOICE messages:
 *
 *   import { AudioPlayer } from '@/components/voice';
 *   const voice = message.attachments.find(a => a.kind === 'VOICE');
 *   {voice && <AudioPlayer src={voice.url} label={`Voice message from ${name}`} />}
 */
export { VoiceRecorder, VoiceRecorderView, type VoiceRecorderProps } from './VoiceRecorder';
export { AudioPlayer, type AudioPlayerProps } from './AudioPlayer';
export type { UploadedVoice } from '@/lib/voice/upload';
