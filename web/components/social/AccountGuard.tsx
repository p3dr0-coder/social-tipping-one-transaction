"use client";

import { useNear } from "~~/lib/near-provider";
import { isNamedAccountId } from "~~/lib/social";
import { LandingPage } from "./LandingPage";

/**
 * Access gate: a connected named account may use the app. A connected implicit account
 * (64 hex characters) has no readable name to show in the social graph, so it gets the
 * landing page with the named-account explanation instead of the app.
 */
export const AccountGuard = ({ children }: { children: React.ReactNode }) => {
  const { accountId } = useNear();

  if (!accountId) {
    return <LandingPage />;
  }

  if (!isNamedAccountId(accountId)) {
    return <LandingPage hasNoAccount />;
  }

  return <>{children}</>;
};
