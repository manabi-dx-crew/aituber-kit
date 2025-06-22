import { getAIChatResponseStream } from "@/features/chat/aiChatFactory";
import { Message, EmotionType } from "@/features/messages/messages";
import { speakCharacter } from "@/features/messages/speakCharacter";
import { judgeSlide } from "@/features/slide/slideAIHelpers";
import homeStore from "@/features/stores/home";
import settingsStore from "@/features/stores/settings";
import slideStore from "@/features/stores/slide";
import { goToSlide } from "@/components/slides";
import { messageSelectors } from "../messages/messageSelectors";
import webSocketStore from "@/features/stores/websocketStore";
import i18next from "i18next";
import toastStore from "@/features/stores/toast";
import { generateMessageId } from "@/utils/messageUtils";

// セッションIDを生成する関数
const generateSessionId = () => generateMessageId();

// コードブロックのデリミネーター
const CODE_DELIMITER = "```";

/**
 * テキストから感情タグ `[...]` を抽出する
 * @param text 入力テキスト
 * @returns 感情タグと残りのテキスト
 */
const extractEmotion = (
  text: string,
): { emotionTag: string; remainingText: string } => {
  // 先頭のスペースを無視して、感情タグを検出
  const emotionMatch = text.match(/^\s*\[(.*?)\]/);
  if (emotionMatch?.[0]) {
    return {
      emotionTag: emotionMatch[0].trim(), // タグ自体の前後のスペースは除去
      // 先頭のスペースも含めて削除し、さらに前後のスペースを除去
      remainingText: text
        .slice(text.indexOf(emotionMatch[0]) + emotionMatch[0].length)
        .trimStart(),
    };
  }
  return { emotionTag: "", remainingText: text };
};

/**
 * テキストから文法的に区切りの良い文を抽出する
 * @param text 入力テキスト
 * @returns 抽出された文と残りのテキスト
 */
const extractSentence = (
  text: string,
): { sentence: string; remainingText: string } => {
  const sentenceMatch = text.match(
    /^(.{1,19}?(?:[。．.!?！？\n]|(?=\[))|.{20,}?(?:[、,。．.!?！？\n]|(?=\[)))/,
  );
  if (sentenceMatch?.[0]) {
    return {
      sentence: sentenceMatch[0],
      remainingText: text.slice(sentenceMatch[0].length).trimStart(),
    };
  }
  return { sentence: "", remainingText: text };
};

/**
 * 発話と関連する状態更新を行う
 * @param sessionId セッションID
 * @param sentence 発話する文
 * @param emotionTag 感情タグ (例: "[neutral]")
 * @param currentAssistantMessageListRef アシスタントメッセージリストの参照
 * @param currentSlideMessagesRef スライドメッセージリストの参照
 */
const handleSpeakAndStateUpdate = (
  sessionId: string,
  sentence: string,
  emotionTag: string,
  currentAssistantMessageListRef: { current: string[] },
  currentSlideMessagesRef: { current: string[] },
) => {
  const hs = homeStore.getState();
  const emotion = emotionTag.includes("[")
    ? (emotionTag.slice(1, -1).toLowerCase() as EmotionType)
    : "neutral";

  // 発話不要/不可能な文字列だった場合はスキップ
  if (
    sentence === "" ||
    sentence.replace(
      /^[\s\u3000\t\n\r\[\(\{「［（【『〈《〔｛«‹〘〚〛〙›»〕》〉』】）］」\}\)\]'"''""・、。,.!?！？:：;；\-_=+~～*＊@＠#＃$＄%％^＾&＆|｜\\＼/／`｀]+$/gu,
      "",
    ) === ""
  ) {
    return;
  }

  speakCharacter(
    sessionId,
    { message: sentence, emotion: emotion },
    () => {
      hs.incrementChatProcessingCount();
      currentSlideMessagesRef.current.push(sentence);
      homeStore.setState({
        slideMessages: [...currentSlideMessagesRef.current],
      });
    },
    () => {
      hs.decrementChatProcessingCount();
      currentSlideMessagesRef.current.shift();
      homeStore.setState({
        slideMessages: [...currentSlideMessagesRef.current],
      });
    },
  );
};

/**
 * 受け取ったメッセージを処理し、AIの応答を生成して発話させる (Refactored)
 * @param receivedMessage 処理する文字列
 */
export const speakMessageHandler = async (receivedMessage: string) => {
  const sessionId = generateSessionId();

  // 感情タグなどを除いたテキストで文字数カウント
  const regex = /\[(emote|tempEmote|expression|style):([^\]]+)\]/g;
  const textForCounting = receivedMessage.replace(regex, "");

  if (textForCounting.length > 200) {
    speakCharacter(
      sessionId,
      {
        message: "こんな感じかな？読んでみて。",
        emotion: "neutral",
      },
      () => {},
      () => {},
    );
    // メッセージ全体をログに追加
    homeStore.getState().upsertMessage({
      role: "assistant",
      content: receivedMessage,
    });
    homeStore.setState({ chatProcessing: false });
    return; // ここで処理を終了
  }

  const currentSlideMessagesRef = { current: [] as string[] };
  const assistantMessageListRef = { current: [] as string[] };

  let isCodeBlock: boolean = false;
  let codeBlockContent: string = "";
  let accumulatedAssistantText: string = "";
  let remainingMessage = receivedMessage;
  let currentMessageId: string = generateMessageId();

  while (remainingMessage.length > 0 || isCodeBlock) {
    let processableText = "";
    let currentCodeBlock = "";

    if (isCodeBlock) {
      if (remainingMessage.includes(CODE_DELIMITER)) {
        const [codeEnd, ...rest] = remainingMessage.split(CODE_DELIMITER);
        currentCodeBlock = codeBlockContent + codeEnd;
        codeBlockContent = "";
        remainingMessage = rest.join(CODE_DELIMITER).trimStart();
        isCodeBlock = false;

        if (accumulatedAssistantText.trim()) {
          homeStore.getState().upsertMessage({
            id: currentMessageId,
            role: "assistant",
            content: accumulatedAssistantText.trim(),
          });
          accumulatedAssistantText = "";
        }
        const codeBlockId = generateMessageId();
        homeStore.getState().upsertMessage({
          id: codeBlockId,
          role: "code",
          content: currentCodeBlock,
        });

        currentMessageId = generateMessageId();
        continue;
      } else {
        codeBlockContent += remainingMessage;
        remainingMessage = "";
        continue;
      }
    } else if (remainingMessage.includes(CODE_DELIMITER)) {
      const [beforeCode, ...rest] = remainingMessage.split(CODE_DELIMITER);
      processableText = beforeCode;
      codeBlockContent = rest.join(CODE_DELIMITER);
      isCodeBlock = true;
      remainingMessage = "";
    } else {
      processableText = remainingMessage;
      remainingMessage = "";
    }

    if (processableText.length > 0) {
      let localRemaining = processableText.trimStart();
      while (localRemaining.length > 0) {
        const prevLocalRemaining = localRemaining;
        const { emotionTag, remainingText: textAfterEmotion } =
          extractEmotion(localRemaining);
        const { sentence, remainingText: textAfterSentence } =
          extractSentence(textAfterEmotion);

        if (sentence) {
          assistantMessageListRef.current.push(sentence);
          const aiText = emotionTag ? `${emotionTag} ${sentence}` : sentence;
          accumulatedAssistantText += aiText + " ";
          handleSpeakAndStateUpdate(
            sessionId,
            sentence,
            emotionTag,
            assistantMessageListRef,
            currentSlideMessagesRef,
          );
          localRemaining = textAfterSentence;
        } else {
          if (localRemaining === prevLocalRemaining && localRemaining) {
            const finalSentence = localRemaining;
            assistantMessageListRef.current.push(finalSentence);
            const aiText = emotionTag
              ? `${emotionTag} ${finalSentence}`
              : finalSentence;
            accumulatedAssistantText += aiText + " ";
            handleSpeakAndStateUpdate(
              sessionId,
              finalSentence,
              emotionTag,
              assistantMessageListRef,
              currentSlideMessagesRef,
            );
            localRemaining = "";
          } else {
            localRemaining = textAfterSentence;
          }
        }
        if (
          localRemaining.length > 0 &&
          localRemaining === prevLocalRemaining &&
          !sentence
        ) {
          console.warn(
            "Potential infinite loop detected in speakMessageHandler, breaking. Remaining:",
            localRemaining,
          );
          const finalSentence = localRemaining;
          assistantMessageListRef.current.push(finalSentence);
          accumulatedAssistantText += finalSentence + " ";
          handleSpeakAndStateUpdate(
            sessionId,
            finalSentence,
            "",
            assistantMessageListRef,
            currentSlideMessagesRef,
          );
          break;
        }
      }
    }

    if (isCodeBlock && codeBlockContent) {
      if (accumulatedAssistantText.trim()) {
        homeStore.getState().upsertMessage({
          id: currentMessageId,
          role: "assistant",
          content: accumulatedAssistantText.trim(),
        });
        accumulatedAssistantText = "";
      }
      remainingMessage = codeBlockContent;
      codeBlockContent = "";
    }
  }

  if (codeBlockContent) {
    if (accumulatedAssistantText.trim()) {
      homeStore.getState().upsertMessage({
        id: currentMessageId,
        role: "assistant",
        content: accumulatedAssistantText.trim(),
      });
      accumulatedAssistantText = "";
    }
    const codeBlockId = generateMessageId();
    homeStore.getState().upsertMessage({
      id: codeBlockId,
      role: "code",
      content: codeBlockContent,
    });
    currentMessageId = generateMessageId();
  }

  if (accumulatedAssistantText.trim()) {
    homeStore.getState().upsertMessage({
      id: currentMessageId,
      role: "assistant",
      content: accumulatedAssistantText.trim(),
    });
  }

  // すべての処理が完了したら、chatProcessing を false に設定
  homeStore.setState({ chatProcessing: false });
};

/**
 * AIの応答を処理し、発話させる
 * @param messages Message[]
 */
export async function processAIResponse(messages: Message[]): Promise<void> {
  const stream = await getAIChatResponseStream(messages);
  if (!stream) {
    homeStore.setState({ chatProcessing: false });
    return;
  }

  const reader = stream.getReader();
  let content = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    content += value;
  }

  await speakMessageHandler(content);
}

/**
 * アシスタントとの会話を行う
 * 画面のチャット欄から入力されたときに実行される処理
 * Youtubeでチャット取得した場合もこの関数を使用する
 */
export const handleSendChat = async (text: string) => {
  const sessionId = generateSessionId();
  const newMessage = text;
  const timestamp = new Date().toISOString();

  if (newMessage === null) return;

  const ss = settingsStore.getState();
  const sls = slideStore.getState();
  const wsManager = webSocketStore.getState().wsManager;
  const modalImage = homeStore.getState().modalImage;

  if (ss.externalLinkageMode) {
    homeStore.setState({ chatProcessing: true });

    if (wsManager?.websocket?.readyState === WebSocket.OPEN) {
      homeStore.getState().upsertMessage({
        role: "user",
        content: newMessage,
        timestamp: timestamp,
      });

      wsManager.websocket.send(
        JSON.stringify({ content: newMessage, type: "chat" }),
      );
    } else {
      toastStore.getState().addToast({
        message: i18next.t("NotConnectedToExternalAssistant"),
        type: "error",
        tag: "not-connected-to-external-assistant",
      });
      homeStore.setState({
        chatProcessing: false,
      });
    }
  } else if (ss.realtimeAPIMode) {
    if (wsManager?.websocket?.readyState === WebSocket.OPEN) {
      homeStore.getState().upsertMessage({
        role: "user",
        content: newMessage,
        timestamp: timestamp,
      });
    }
  } else {
    let systemPrompt = ss.systemPrompt;
    if (ss.slideMode) {
      if (sls.isPlaying) {
        return;
      }

      try {
        let scripts = JSON.stringify(
          require(
            `../../../public/slides/${sls.selectedSlideDocs}/scripts.json`,
          ),
        );
        systemPrompt = systemPrompt.replace("{{SCRIPTS}}", scripts);

        let supplement = "";
        try {
          const response = await fetch(
            `/api/getSupplement?slideName=${sls.selectedSlideDocs}`,
          );
          if (!response.ok) {
            throw new Error("Failed to fetch supplement");
          }
          const data = await response.json();
          supplement = data.supplement;
          systemPrompt = systemPrompt.replace("{{SUPPLEMENT}}", supplement);
        } catch (e) {
          console.error("supplement.txtの読み込みに失敗しました:", e);
        }

        const answerString = await judgeSlide(newMessage, scripts, supplement);
        const answer = JSON.parse(answerString);
        if (answer.judge === "true" && answer.page !== "") {
          goToSlide(Number(answer.page));
          systemPrompt += `\n\nEspecial Page Number is ${answer.page}.`;
        }
      } catch (e) {
        console.error(e);
      }
    }

    homeStore.setState({ chatProcessing: true });
    const userMessageContent: Message["content"] = modalImage
      ? [
          { type: "text" as const, text: newMessage },
          { type: "image" as const, image: modalImage },
        ]
      : newMessage;

    homeStore.getState().upsertMessage({
      role: "user",
      content: userMessageContent,
      timestamp: timestamp,
    });

    if (modalImage) {
      homeStore.setState({ modalImage: "" });
    }

    const currentChatLog = homeStore.getState().chatLog;

    const messages: Message[] = [
      {
        role: "system",
        content: systemPrompt,
      },
      ...messageSelectors.getProcessedMessages(
        currentChatLog,
        ss.includeTimestampInUserMessage,
      ),
    ];

    try {
      await processAIResponse(messages);
    } catch (e) {
      console.error(e);
      homeStore.setState({ chatProcessing: false });
    }
  }
};

/**
 * WebSocketからのテキストを受信したときの処理
 */
export const handleReceiveTextFromWsFn =
  () =>
  async (
    text: string,
    role?: string,
    emotion: EmotionType = "neutral",
    type?: string,
  ) => {
    const sessionId = generateSessionId();
    if (text === null || role === undefined) return;

    const ss = settingsStore.getState();
    const hs = homeStore.getState();
    const wsManager = webSocketStore.getState().wsManager;

    // 外部連携モードでない場合は処理を中断
    if (!ss.externalLinkageMode) return;

    // ローディング表示を追加
    homeStore.setState({ chatProcessing: true });

    if (role !== "user") {
      if (type === "start") {
        // startの場合は何もしない（textは空文字のため）
        console.log("Starting new response");
        wsManager?.setTextBlockStarted(false);
      } else if (
        hs.chatLog.length > 0 &&
        hs.chatLog[hs.chatLog.length - 1].role === role &&
        wsManager?.textBlockStarted
      ) {
        // 前のメッセージと役割が同じで、ブロックが開始されている場合は追記
        const lastMessage = hs.chatLog[hs.chatLog.length - 1];
        let lastContent = "";
        if (typeof lastMessage.content === "string") {
          lastContent = lastMessage.content;
        } else if (
          Array.isArray(lastMessage.content) &&
          lastMessage.content.length > 0
        ) {
          const lastPart = lastMessage.content[lastMessage.content.length - 1];
          if (lastPart.type === "text") {
            lastContent = lastPart.text;
          }
        }
        homeStore.getState().upsertMessage({
          id: lastMessage.id,
          role: role,
          content: lastContent + text,
        });
      } else {
        // 新しいメッセージを追加（新規IDを生成）
        homeStore.getState().upsertMessage({
          role: role,
          content: text,
        });
        wsManager?.setTextBlockStarted(true);
      }

      if (role === "assistant" && text !== "") {
        try {
          // 文ごとに音声を生成 & 再生、返答を表示
          speakCharacter(
            sessionId,
            {
              message: text,
              emotion: emotion,
            },
            () => {
              // start
            },
            () => {
              // end
            },
          );
        } catch (e) {
          console.error(e);
        }
      }

      if (type === "end") {
        // レスポンスの終了処理
        console.log("Response ended");
        wsManager?.setTextBlockStarted(false);
        homeStore.setState({ chatProcessing: false });
      }
    }

    homeStore.setState({ chatProcessing: type !== "end" });
  };

/**
 * リアルタイムAPIからのテキストを受信したときの処理
 */
export const handleReceiveTextFromRtFn = () => {
  const ss = settingsStore.getState();
  const wsManager = webSocketStore.getState().wsManager;
  const hs = homeStore.getState();

  return async (
    text: string,
    role?: string,
    type?: string,
    buffer?: ArrayBuffer,
  ) => {
    const sessionId = generateSessionId();
    if (text === null || role === undefined) return;

    // リアルタイムAPIモードでない場合は処理を中断
    if (!ss.realtimeAPIMode) return;

    if (type === "chat") {
      // 発話予約
      speakCharacter(
        sessionId,
        {
          message: text,
          emotion: "neutral",
        },
        () => {},
        () => {},
      );
    } else if (type === "user") {
      // ユーザーメッセージの追加
      if (
        hs.chatLog.length > 0 &&
        hs.chatLog[hs.chatLog.length - 1].role === role &&
        wsManager?.textBlockStarted
      ) {
        // 前のメッセージと役割が同じで、ブロックが開始されている場合は追記
        const lastMessage = hs.chatLog[hs.chatLog.length - 1];
        let lastContent = "";
        if (typeof lastMessage.content === "string") {
          lastContent = lastMessage.content;
        } else if (
          Array.isArray(lastMessage.content) &&
          lastMessage.content.length > 0
        ) {
          const lastPart = lastMessage.content[lastMessage.content.length - 1];
          if (lastPart.type === "text") {
            lastContent = lastPart.text;
          }
        }
        homeStore.getState().upsertMessage({
          id: lastMessage.id,
          role: role,
          content: lastContent + text,
        });
      } else {
        // 新しいメッセージを追加（新規IDを生成）
        homeStore.getState().upsertMessage({
          role: role,
          content: text,
        });
        wsManager?.setTextBlockStarted(true);
      }
    } else if (type === "start") {
      // ローディング表示を追加
      homeStore.setState({ chatProcessing: true });
      wsManager?.setTextBlockStarted(false);
    } else if (type === "end") {
      // レスポンスの終了処理
      wsManager?.setTextBlockStarted(false);
      homeStore.setState({ chatProcessing: false });
    }
  };
};
