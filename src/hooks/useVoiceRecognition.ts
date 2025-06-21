import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import settingsStore from "@/features/stores/settings";
import homeStore from "@/features/stores/home";
import { SpeakQueue } from "@/features/messages/speakQueue";
import { useBrowserSpeechRecognition } from "./useBrowserSpeechRecognition";
import { useWhisperRecognition } from "./useWhisperRecognition";
import { useRealtimeVoiceAPI } from "./useRealtimeVoiceAPI";

type UseVoiceRecognitionProps = {
  onChatProcessStart: (text: string) => void;
};

/**
 * 音声認識フックのメインインターフェース
 * 各モード（ブラウザ、Whisper、リアルタイムAPI）に応じて適切なフックを使用
 */
export const useVoiceRecognition = ({
  onChatProcessStart,
}: UseVoiceRecognitionProps) => {
  // ----- 設定の取得 -----
  const speechRecognitionMode = settingsStore((s) => s.speechRecognitionMode);
  const realtimeAPIMode = settingsStore((s) => s.realtimeAPIMode);
  const continuousMicListeningMode = settingsStore(
    (s) => s.continuousMicListeningMode,
  );

  // ----- 各モードのフックを使用 -----
  // ブラウザ音声認識フック
  const browserSpeech = useBrowserSpeechRecognition(onChatProcessStart);

  // Whisper音声認識フック
  const whisperSpeech = useWhisperRecognition(onChatProcessStart);

  // リアルタイムAPI処理フック
  const realtimeAPI = useRealtimeVoiceAPI(onChatProcessStart);

  // ----- 現在のモードに基づいて適切なフックを選択 -----
  const currentHook = useMemo(() => {
    return speechRecognitionMode === "browser"
      ? realtimeAPIMode
        ? realtimeAPI
        : browserSpeech
      : whisperSpeech;
  }, [
    speechRecognitionMode,
    realtimeAPIMode,
    realtimeAPI,
    browserSpeech,
    whisperSpeech,
  ]);

  // ----- 音声停止 -----
  const handleStopSpeaking = useCallback(() => {
    // isSpeaking を false に設定し、発話キューを完全に停止
    homeStore.setState({ isSpeaking: false });
    SpeakQueue.stopAll();
  }, []);

  // AIの発話完了後に音声認識を自動的に再開する処理
  const handleSpeakCompletion = useCallback(() => {
    // 常時マイク入力モードがONで、現在マイク入力が行われていない場合のみ実行
    if (
      continuousMicListeningMode &&
      // !currentHook.isListening &&
      speechRecognitionMode === "browser" &&
      !homeStore.getState().chatProcessing
    ) {
      console.log("🔄 AIの発話が完了しました。音声認識を自動的に再開します。");
      setTimeout(() => {
        currentHook.startListening();
      }, 300); // マイク起動までに少し遅延を入れる
    }
  }, [continuousMicListeningMode, speechRecognitionMode, currentHook]);

  // 常時マイク入力モードの変更を監視
  useEffect(() => {
    if (
      continuousMicListeningMode &&
      !currentHook.isListening &&
      speechRecognitionMode === "browser" &&
      !homeStore.getState().isSpeaking &&
      !homeStore.getState().chatProcessing
    ) {
      // 常時マイク入力モードがONになった場合、自動的にマイク入力を開始
      console.log(
        "🎤 常時マイク入力モードがONになりました。音声認識を開始します。",
      );
      currentHook.startListening();
    }
  }, [continuousMicListeningMode, speechRecognitionMode, currentHook]);

  // 発話完了時のコールバックを登録
  useEffect(() => {
    // ブラウザモードでのみコールバックを登録
    if (speechRecognitionMode === "browser") {
      SpeakQueue.onSpeakCompletion(handleSpeakCompletion);

      return () => {
        // コンポーネントのアンマウント時にコールバックを削除
        SpeakQueue.removeSpeakCompletionCallback(handleSpeakCompletion);
      };
    }
  }, [speechRecognitionMode, handleSpeakCompletion]);

  // コンポーネントのマウント時に常時マイク入力モードがONの場合は自動的にマイク入力を開始
  useEffect(() => {
    if (
      continuousMicListeningMode &&
      speechRecognitionMode === "browser" &&
      !currentHook.isListening &&
      !homeStore.getState().isSpeaking &&
      !homeStore.getState().chatProcessing
    ) {
      const delayedStart = async () => {
        console.log(
          "🎤 コンポーネントマウント時に音声認識を自動的に開始します",
        );
        // コンポーネントマウント時に少し遅延させてから開始
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (
          continuousMicListeningMode &&
          !currentHook.isListening &&
          !homeStore.getState().isSpeaking &&
          !homeStore.getState().chatProcessing
        ) {
          currentHook.startListening();
        }
      };

      delayedStart();
    }

    return () => {
      // コンポーネントのアンマウント時にマイク入力を停止
      if (currentHook.isListening) {
        currentHook.stopListening();
      }
    };
  }, [continuousMicListeningMode, currentHook, speechRecognitionMode]); // マウント時のみ実行

  // ----- キーボードショートカットの設定 -----
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.key === "Alt" && !currentHook.isListening) {
        // Alt キーを押した時の処理
        handleStopSpeaking();
        await currentHook.startListening();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Alt" && currentHook.isListening) {
        // Alt キーを離した時の処理
        // マイクボタンと同じ動作をさせるため、toggleListeningを使用せず
        // stopListeningを直接呼び出し、テキストが存在する場合は送信する
        if (currentHook.userMessage.trim()) {
          // chatProcessing を先に true に設定
          homeStore.setState({ chatProcessing: true });
          // メッセージを空にする
          currentHook.handleInputChange({
            target: { value: "" },
          } as React.ChangeEvent<HTMLTextAreaElement>);
          // 処理を開始
          onChatProcessStart(currentHook.userMessage.trim());
          currentHook.stopListening();
        } else {
          currentHook.stopListening();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [currentHook, handleStopSpeaking, onChatProcessStart]);

  // 現在のモードに基づいて適切なフックのAPIを返す
  return {
    userMessage: currentHook.userMessage,
    isListening: currentHook.isListening,
    isProcessing:
      "isProcessing" in currentHook ? currentHook.isProcessing : false,
    silenceTimeoutRemaining: currentHook.silenceTimeoutRemaining,
    handleInputChange: currentHook.handleInputChange,
    handleSendMessage: currentHook.handleSendMessage,
    toggleListening: currentHook.toggleListening,
    handleStopSpeaking,
    startListening: currentHook.startListening,
    stopListening: currentHook.stopListening,
  };
};
