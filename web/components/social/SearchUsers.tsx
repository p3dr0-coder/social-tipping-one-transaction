"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { Avatar } from "./Avatar";
import { isValidAccountId, searchAccounts, type AccountCard } from "~~/lib/social";

export const SearchUsers = () => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AccountCard[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const router = useRouter();
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      searchAccounts(trimmed)
        .then(items => {
          if (cancelled) return;
          setResults(items.slice(0, 5));
          setIsOpen(true);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const goToAccount = (candidate: string) => {
    const accountId = candidate.trim().toLowerCase();
    if (!isValidAccountId(accountId)) return;
    router.push(`/${accountId}`);
    setQuery("");
    setIsOpen(false);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    goToAccount(query);
  };

  const directMatch = query.trim().toLowerCase();

  return (
    <div className="relative w-full" ref={wrapperRef}>
      <form onSubmit={handleSubmit} className="relative group">
        <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
          <MagnifyingGlassIcon className="h-5 w-5 opacity-40 group-focus-within:opacity-100 group-focus-within:text-primary transition-all" />
        </div>
        <input
          type="text"
          aria-label="Search accounts"
          className="w-full bg-base-100 border-2 border-primary/10 rounded-[1.5rem] py-4 pl-12 pr-4 text-sm font-bold focus:outline-none focus:border-primary/40 focus:bg-base-100 transition-all shadow-sm"
          value={query}
          onChange={event => setQuery(event.target.value)}
          onFocus={() => query.trim().length > 0 && setIsOpen(true)}
        />
      </form>

      {isOpen && query.trim().length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-3 bg-base-100 border border-base-content/10 rounded-[1.5rem] shadow-2xl z-[100] overflow-hidden backdrop-blur-xl">
          <div className="p-2 flex flex-col gap-1">
            {isValidAccountId(directMatch) && !results.some(card => card.account_id === directMatch) && (
              <button
                onClick={() => goToAccount(directMatch)}
                className="w-full flex items-center gap-3 p-3 hover:bg-primary/10 rounded-xl transition-colors text-left group"
              >
                <div className="w-10 h-10 rounded-full overflow-hidden border border-base-content/10 shrink-0">
                  <Avatar accountId={directMatch} className="w-10 h-10" />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-black truncate group-hover:text-primary transition-colors">
                    Go to {directMatch}
                  </span>
                  <span className="text-[10px] opacity-40 uppercase font-mono italic">Direct account id</span>
                </div>
              </button>
            )}

            {results.map(card => (
              <button
                key={card.account_id}
                onClick={() => goToAccount(card.account_id)}
                className="w-full flex items-center gap-3 p-3 hover:bg-primary/10 rounded-xl transition-colors text-left group"
              >
                <div className="w-10 h-10 rounded-full overflow-hidden border border-base-content/10 shrink-0">
                  <Avatar accountId={card.account_id} avatar={card.avatar_url} className="w-10 h-10" />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-black truncate group-hover:text-primary transition-colors">
                    {card.name ?? card.account_id}
                  </span>
                  <span className="text-[10px] opacity-40 font-mono truncate">{card.account_id}</span>
                </div>
                {typeof card.followers === "number" && (
                  <span className="ml-auto text-[10px] opacity-40 font-mono">{card.followers} followers</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
