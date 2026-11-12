"use client";

import { useCallback, useState } from "react";
import { notification } from "~~/utils/notification";
import type { WalletConnection } from "./social";
import { sendTip } from "./tips";

type TipAuthorInput = {
  authorId: string;
  viewerId: string | null;
  signAndSendTransaction: WalletConnection["signAndSendTransaction"];
};

/** Shared tip action for a post card and the account profile page. */
export function useTipAuthor({ authorId, viewerId, signAndSendTransaction }: TipAuthorInput) {
  const [tipping, setTipping] = useState(false);

  const tipAuthor = useCallback(async () => {
    if (!viewerId) {
      notification.error("Connect a wallet first");
      return;
    }
    setTipping(true);
    try {
      const hash = await sendTip(authorId, null, { accountId: viewerId, signAndSendTransaction });
      notification.success(`Tip settled: ${hash.slice(0, 10)}...`);
    } catch (error) {
      notification.error(error instanceof Error ? error.message : "The tip could not be sent");
    } finally {
      setTipping(false);
    }
  }, [authorId, viewerId, signAndSendTransaction]);

  return { tipAuthor, tipping };
}
