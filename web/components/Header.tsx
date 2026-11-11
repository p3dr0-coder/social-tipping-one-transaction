"use client";

import { useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bars3Icon, ClipboardDocumentIcon, PowerIcon } from "@heroicons/react/24/outline";
import { useNear } from "~~/lib/near-provider";
import { notification } from "~~/utils/notification";

type HeaderMenuLink = {
  label: string;
  href: string;
};

const authenticatedMenuLinks: HeaderMenuLink[] = [
  {
    label: "Home",
    href: "/",
  },
  {
    label: "Profile",
    href: "/profile",
  },
];

export const HeaderMenuLinks = () => {
  const pathname = usePathname();
  const { accountId } = useNear();

  // Menu links only exist once a named account is connected.
  if (!accountId) return null;

  return (
    <>
      {authenticatedMenuLinks.map(({ label, href }) => {
        const isActive = pathname === href;
        return (
          <li key={href}>
            <Link
              href={href}
              className={`${
                isActive ? "bg-secondary shadow-md" : ""
              } hover:bg-secondary hover:shadow-md focus:!bg-secondary active:!text-neutral py-1.5 px-3 text-sm rounded-full gap-2 grid grid-flow-col`}
            >
              <span>{label}</span>
            </Link>
          </li>
        );
      })}
    </>
  );
};

/**
 * Site header
 */
export const Header = () => {
  const { accountId, connect, disconnect } = useNear();
  const burgerMenuRef = useRef<HTMLDetailsElement>(null);

  const handleConnect = async () => {
    try {
      await connect();
    } catch (error) {
      notification.error(error instanceof Error ? error.message : "The wallet could not connect");
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnect();
      notification.success("Wallet disconnected");
    } catch (error) {
      notification.error(error instanceof Error ? error.message : "The wallet could not disconnect");
    }
  };

  const copyAccountId = async () => {
    if (!accountId) return;
    await navigator.clipboard.writeText(accountId);
    notification.success("Account id copied");
  };

  return (
    <div className="sticky lg:static top-0 navbar bg-base-100/70 backdrop-blur-md min-h-0 shrink-0 justify-between z-20 px-0 sm:px-2 border-b border-base-300">
      <div className="navbar-start w-auto lg:w-1/2">
        <details className="dropdown" ref={burgerMenuRef}>
          <summary className="ml-1 btn btn-ghost lg:hidden hover:bg-transparent">
            <Bars3Icon className="h-1/2" />
          </summary>
          <ul
            className="menu menu-compact dropdown-content mt-3 p-2 shadow-sm bg-base-100 rounded-box w-52"
            onClick={() => {
              burgerMenuRef.current?.removeAttribute("open");
            }}
          >
            <HeaderMenuLinks />
          </ul>
        </details>
        <Link href="/" className="hidden lg:flex items-center gap-2 ml-4 mr-6 shrink-0">
          <Image src="/logo.png" alt="philia logo" width={40} height={40} className="rounded-xl shadow-lg" />
          <div className="flex flex-col">
            <span className="font-black leading-tight text-lg tracking-tight">philia</span>
            <span className="text-[10px] uppercase font-black tracking-widest opacity-40">social on NEAR</span>
          </div>
        </Link>
        <ul className="hidden lg:flex lg:flex-nowrap menu menu-horizontal px-1 gap-2">
          <HeaderMenuLinks />
        </ul>
      </div>
      <div className="navbar-end grow mr-4">
        {accountId ? (
          <details className="dropdown dropdown-end">
            <summary className="btn btn-ghost rounded-full border border-base-300 normal-case">
              <span className="w-2 h-2 rounded-full bg-success" />
              <span className="max-w-[14rem] truncate font-mono text-xs" title={accountId}>
                {accountId}
              </span>
            </summary>
            <ul className="menu dropdown-content mt-3 p-2 shadow bg-base-100 rounded-box w-72 z-30">
              <li>
                <button onClick={copyAccountId} className="gap-2">
                  <ClipboardDocumentIcon className="h-4 w-4" />
                  Copy account id
                </button>
              </li>
              <li>
                <button onClick={handleDisconnect} className="gap-2">
                  <PowerIcon className="h-4 w-4" />
                  Disconnect
                </button>
              </li>
            </ul>
          </details>
        ) : (
          <button onClick={handleConnect} className="btn btn-primary btn-sm rounded-full px-6">
            Connect wallet
          </button>
        )}
      </div>
    </div>
  );
};
