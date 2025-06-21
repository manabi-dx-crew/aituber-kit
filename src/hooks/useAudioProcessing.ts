import { useEffect, useState, useCallback, useRef } from "react";

// AudioContext の型定義を拡張
type AudioContextType = typeof AudioContext;

/**
 * オーディオ処理のためのカスタムフック
 * 録音機能とオーディオバッファの管理を担当
 */
export const useAudioProcessing = () => {
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(
    null,
  );
  const audioChunksRef = useRef<Blob[]>([]);

  // AudioContextの初期化
  useEffect(() => {
    const AudioContextClass = (window.AudioContext ||
      (window as any).webkitAudioContext) as AudioContextType;
    const context = new AudioContextClass();
    setAudioContext(context);

    // クリーンアップ関数
    return () => {
      if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
      }
      context.close().catch(console.error);
    };
  }, [mediaRecorder]);

  /**
   * マイク権限を確認する関数
   */
  const checkMicrophonePermission = async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      return true;
    } catch (error) {
      console.error("Microphone permission error:", error);
      return false;
    }
  };

  /**
   * メディアレコーダーを開始する関数
   * @param options - MediaRecorderのオプション
   */
  const startRecording = useCallback(
    async (options?: MediaRecorderOptions): Promise<boolean> => {
      try {
        const hasPermission = await checkMicrophonePermission();
        if (!hasPermission) return false;

        // 既存のレコーダーを停止
        if (mediaRecorder && mediaRecorder.state !== "inactive") {
          mediaRecorder.stop();
        }

        // オーディオチャンクをリセット
        audioChunksRef.current = [];

        // オーディオストリームを取得
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            sampleRate: 16000,
            echoCancellation: true,
            noiseSuppression: true,
          },
        });

        // MediaRecorderでサポートされているmimeTypeを確認
        const mimeTypes = [
          "audio/mp3",
          "audio/mp4",
          "audio/mpeg",
          "audio/ogg",
          "audio/wav",
          "audio/webm",
          "audio/webm;codecs=opus",
        ];

        let selectedMimeType = "audio/webm";
        for (const type of mimeTypes) {
          if (MediaRecorder.isTypeSupported(type)) {
            selectedMimeType = type;
            // mp3とoggを優先
            if (type === "audio/mp3" || type === "audio/ogg") {
              break;
            }
          }
        }

        console.log(`Using MIME type: ${selectedMimeType} for recording`);

        // デフォルトのオプションをマージ
        const recorderOptions = {
          mimeType: selectedMimeType,
          audioBitsPerSecond: 128000,
          ...options,
        };

        // レコーダーを作成
        const recorder = new MediaRecorder(stream, recorderOptions);

        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunksRef.current.push(event.data);
            console.log(
              "Recording: added chunk, size:",
              event.data.size,
              "type:",
              event.data.type,
            );
          }
        };

        setMediaRecorder(recorder);
        recorder.start(100); // 100msごとにデータ収集
        return true;
      } catch (error) {
        console.error("Error starting recording:", error);
        return false;
      }
    },
    [mediaRecorder],
  );

  /**
   * 録音を停止し、録音データを取得する関数
   */
  const stopRecording = useCallback(async (): Promise<Blob | null> => {
    if (!mediaRecorder || mediaRecorder.state === "inactive") {
      console.log("🔴 MediaRecorder停止: すでに非アクティブ状態です");
      return null;
    }

    console.log("🎤 MediaRecorder停止開始: 現在の状態:", mediaRecorder.state);

    // 重要: 先にトラックを停止すると、残りのデータが失われる可能性がある
    // そのため、まずMediaRecorderを停止し、すべてのデータを収集してから
    // トラックを停止する順序が重要

    return new Promise<Blob | null>((resolve) => {
      // 現在のチャンクを保持
      const currentChunks = [...audioChunksRef.current];
      console.log(`🎤 停止前のチャンク数: ${currentChunks.length}`);

      // ondataavailableイベントは停止後にも発火する可能性がある
      const oldDataAvailableHandler = mediaRecorder.ondataavailable;
      mediaRecorder.ondataavailable = (event) => {
        // 元のハンドラも呼び出す
        if (oldDataAvailableHandler)
          oldDataAvailableHandler.call(mediaRecorder, event);

        if (event.data.size > 0) {
          currentChunks.push(event.data);
          console.log(
            `🎤 停止処理中に新しいチャンクを追加: サイズ=${event.data.size}, 合計=${currentChunks.length}`,
          );
        }
      };

      // onstopハンドラを設定
      mediaRecorder.onstop = () => {
        console.log(
          `🎤 MediaRecorder停止完了イベント発生: チャンク数=${currentChunks.length}`,
        );

        let audioBlob = null;
        if (currentChunks.length > 0) {
          // 保存されたMIMEタイプを取得
          let blobType = "audio/webm";
          if (mediaRecorder.mimeType && mediaRecorder.mimeType !== "") {
            blobType = mediaRecorder.mimeType;
          }

          // 音声チャンクをマージしてBlobに変換
          audioBlob = new Blob(currentChunks, { type: blobType });
          console.log(
            `🎤 音声Blobを作成: サイズ=${audioBlob.size}バイト, タイプ=${blobType}`,
          );
        } else {
          console.log("🔴 録音データなし: チャンクは収集されませんでした");
        }

        // mediaRecorderのストリームを停止
        try {
          if (mediaRecorder.stream) {
            console.log("🎤 オーディオストリームのトラックを停止します");
            mediaRecorder.stream.getTracks().forEach((track) => {
              track.stop();
              console.log(
                `🎤 オーディオトラック停止: ID=${track.id}, 種類=${track.kind}`,
              );
            });
          }
        } catch (trackError) {
          console.error("🔴 トラック停止エラー:", trackError);
        }

        // グローバルなオーディオチャンク配列をクリア
        audioChunksRef.current = [];
        console.log("🎤 グローバルオーディオチャンク配列をクリア");

        // 結果を返す
        resolve(audioBlob);
      };

      // stopメソッドを呼び出す
      try {
        mediaRecorder.stop();
        console.log("🎤 MediaRecorder.stop()メソッド呼び出し成功");
      } catch (error) {
        console.error("🔴 MediaRecorder.stop()エラー:", error);

        // エラーが発生した場合でも、ストリームを停止し、現在のチャンクでBlobを作成
        try {
          if (mediaRecorder.stream) {
            mediaRecorder.stream.getTracks().forEach((track) => track.stop());
          }
        } catch (trackError) {
          console.error("🔴 エラー発生後のトラック停止エラー:", trackError);
        }

        // 現在のチャンクでBlobを作成
        let audioBlob = null;
        if (currentChunks.length > 0) {
          audioBlob = new Blob(currentChunks, { type: "audio/webm" });
        }

        // グローバルなオーディオチャンク配列をクリア
        audioChunksRef.current = [];

        // 結果を返す
        resolve(audioBlob);
      }
    });
  }, [mediaRecorder]);

  /**
   * AudioBuffer をデコードする関数
   */
  const decodeAudioData = useCallback(
    async (arrayBuffer: ArrayBuffer): Promise<AudioBuffer | null> => {
      if (!audioContext) return null;

      try {
        return await audioContext.decodeAudioData(arrayBuffer);
      } catch (error) {
        console.error("Failed to decode audio data:", error);
        return null;
      }
    },
    [audioContext],
  );

  return {
    audioContext,
    mediaRecorder,
    audioChunksRef,
    checkMicrophonePermission,
    startRecording,
    stopRecording,
    decodeAudioData,
  };
};
