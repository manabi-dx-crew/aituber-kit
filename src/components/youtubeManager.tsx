import { FC } from "react";
import useYoutube from "./useYoutube";
import { handleSendChat } from "@/features/chat/handlers";

export const YoutubeManager: FC = () => {
  useYoutube({ handleSendChat });

  return null;
};
