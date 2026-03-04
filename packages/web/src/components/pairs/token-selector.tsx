"use client";

import { useState, useMemo } from "react";
import { useAccount, useBalance, useReadContract, useReadContracts } from "wagmi";
import { formatUnits } from "viem";
import { erc20Abi } from "viem";
import { isAddress } from "viem";
import { base } from "viem/chains";
import { TOKENS } from "@/lib/constants";
import { useTokenInfo } from "@/hooks/use-token-info";
import { useTokenSearch } from "@/hooks/use-token-search";
import { usePortfolioTokens } from "@/hooks/use-portfolio-tokens";

function shortAddr(addr: string) {
  if (addr === "native") return "ETH";
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

const OPTIONS = [
  TOKENS.USDC,
  TOKENS.WETH,
  TOKENS.AERO,
  TOKENS.cbETH,
  TOKENS.DEGEN,
  TOKENS.WBTC,
  TOKENS.wstETH,
  TOKENS.BRETT,
  TOKENS.TOSHI,
  TOKENS.OWB,
];

type TokenSelectorProps = {
  value: string | null;
  onChange: (address: string) => void;
  excludeAddress?: string;
};

export function TokenSelector({
  value,
  onChange,
  excludeAddress,
}: TokenSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { address } = useAccount();
  const { items: portfolioItems } = usePortfolioTokens();

  // Read symbol/decimals from contract for all known options + selected token
  const infoAddrs = useMemo(
    () => [...OPTIONS, ...(value ? [value] : [])],
    [value]
  );
  const { getSymbol: getTokenSymbol, getDecimals: getTokenDecimals, tokenInfo } = useTokenInfo(infoAddrs);

  const { data: searchResults = [], isFetching } = useTokenSearch(search);

  const { data: ethBalance } = useBalance({
    address,
    chainId: base.id,
  });

  const { data: balances } = useReadContracts({
    contracts: OPTIONS.map((token) => ({
      address: token as `0x${string}`,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: address ? [address] : undefined,
    })),
  });

  const isCustomAddress =
    search.startsWith("0x") && search.length >= 42 && isAddress(search);
  const customAddr = isCustomAddress ? (search as `0x${string}`) : null;

  const { data: customSymbol } = useReadContract({
    address: customAddr ?? undefined,
    abi: erc20Abi,
    functionName: "symbol",
  });
  const { data: customDecimals } = useReadContract({
    address: customAddr ?? undefined,
    abi: erc20Abi,
    functionName: "decimals",
  });

  const localFiltered = OPTIONS.filter((addr) => {
    if (addr.toLowerCase() === excludeAddress?.toLowerCase()) return false;
    const info = tokenInfo[addr.toLowerCase()];
    const sym = info?.symbol?.toLowerCase() ?? "";
    const q = search.toLowerCase();
    return sym.includes(q) || addr.toLowerCase().includes(q);
  });

  const globalTokens = useMemo(() => {
    const seen = new Set(localFiltered.map((a) => a.toLowerCase()));
    const list: { address: string; symbol: string }[] = [];
    for (const t of searchResults) {
      const a = t.address.toLowerCase();
      if (!seen.has(a) && a !== excludeAddress?.toLowerCase()) {
        seen.add(a);
        list.push(t);
      }
    }
    return list;
  }, [searchResults, localFiltered, excludeAddress]);

  const customToken =
    customAddr && customAddr.toLowerCase() !== excludeAddress?.toLowerCase()
      ? {
          addr: customAddr,
          symbol:
            typeof customSymbol === "string"
              ? customSymbol
              : customDecimals !== undefined
                ? "Token"
                : null,
        }
      : null;

  const showCustomToken = customToken && (customToken.symbol || customAddr);

  const { data: customBalance } = useReadContract({
    address: customAddr ?? undefined,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!customAddr },
  });

  const globalAddresses = globalTokens.map((t) => t.address);
  const { data: globalBalancesData } = useReadContracts({
    contracts: globalAddresses.flatMap((addr) => [
      {
        address: addr as `0x${string}`,
        abi: erc20Abi,
        functionName: "balanceOf" as const,
        args: address ? [address] : undefined,
      },
      {
        address: addr as `0x${string}`,
        abi: erc20Abi,
        functionName: "decimals" as const,
      },
    ]),
    query: { enabled: !!address && globalAddresses.length > 0 },
  });

  const portfolioFiltered = portfolioItems.filter(
    (p) =>
      p.tokenAddress.toLowerCase() !== excludeAddress?.toLowerCase() &&
      (!search ||
        p.symbol.toLowerCase().includes(search.toLowerCase()) ||
        p.tokenAddress.toLowerCase().includes(search.toLowerCase()))
  );

  const hasResults =
    showCustomToken ||
    localFiltered.length > 0 ||
    globalTokens.length > 0 ||
    portfolioFiltered.length > 0;

  const { data: selectedTokenData } = useReadContracts({
    contracts: value && value.startsWith("0x")
      ? [
          { address: value as `0x${string}`, abi: erc20Abi, functionName: "symbol" as const },
          { address: value as `0x${string}`, abi: erc20Abi, functionName: "decimals" as const },
          {
            address: value as `0x${string}`,
            abi: erc20Abi,
            functionName: "balanceOf" as const,
            args: address ? [address] : undefined,
          },
        ]
      : [],
  });

  const nativeEthAmount = ethBalance?.value
    ? Number(formatUnits(ethBalance.value, 18))
    : 0;
  const baseSymbol = value
    ? getTokenSymbol(value)
    : null;
  const isWethAddr = value?.toLowerCase() === TOKENS.WETH.toLowerCase();
  const selectedSymbol =
    isWethAddr && nativeEthAmount > 0 && baseSymbol === "WETH"
      ? "ETH"
      : baseSymbol;

  const selectedDecimals = value
    ? getTokenDecimals(value)
    : 18;

  const selectedBalanceRaw = selectedTokenData?.[2]?.result as
    | bigint
    | undefined;
  const isWeth = value?.toLowerCase() === TOKENS.WETH.toLowerCase();
  const wrappedBal = selectedBalanceRaw
    ? Number(formatUnits(selectedBalanceRaw, selectedDecimals))
    : 0;
  const selectedBalance =
    value && isWeth
      ? nativeEthAmount + wrappedBal
      : selectedBalanceRaw
        ? Number(formatUnits(selectedBalanceRaw, selectedDecimals))
        : null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between rounded-lg border border-white/20 bg-white/5 px-4 py-3 text-left text-white hover:border-white/40"
      >
        <span>
          {selectedSymbol ?? "Select token"}
          {address && selectedBalance != null && selectedBalance > 0 && (
            <span className="ml-2 text-sm font-normal text-white/50">
              {selectedBalance.toLocaleString(undefined, {
                maximumFractionDigits: 4,
              })}
            </span>
          )}
        </span>
        <span className="text-white/50">▼</span>
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="absolute top-full left-0 right-0 z-20 mt-1 max-h-60 overflow-auto rounded-lg border border-white/20 bg-[#0a0a0a]">
            <input
              type="text"
              placeholder="Symbol or address (0x...)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full border-b border-white/10 bg-transparent px-4 py-2 text-white placeholder:text-white/40"
            />
            {portfolioFiltered.length > 0 && (
              <>
                <div className="px-4 py-2 text-xs font-medium text-white/40">
                  My portfolio
                </div>
                {portfolioFiltered.map((p) => (
                    <button
                      key={p.address}
                      type="button"
                      onClick={() => {
                        onChange(p.tokenAddress);
                        setOpen(false);
                      }}
                      className="flex w-full items-center justify-between px-4 py-2 text-left text-white hover:bg-white/10"
                    >
                      <span>
                        {p.symbol}{" "}
                        <span className="text-white/40">
                          {shortAddr(p.tokenAddress)}
                        </span>
                      </span>
                      {address && (
                        <span className="text-sm text-white/50">
                          {p.balance.toLocaleString(undefined, {
                            maximumFractionDigits: 4,
                          })}
                        </span>
                      )}
                    </button>
                  ))}
              </>
            )}
            {showCustomToken && (() => {
              const dec = typeof customDecimals === "number" ? customDecimals : 18;
              const bal = customBalance ? Number(formatUnits(customBalance, dec)) : 0;
              return (
                <button
                  type="button"
                  onClick={() => {
                    onChange(customToken!.addr);
                    setOpen(false);
                  }}
                  className="flex w-full items-center justify-between px-4 py-2 text-left text-white hover:bg-white/10"
                >
                  <span>
                    {customToken!.symbol || "Token"}{" "}
                    <span className="text-white/40">
                      {shortAddr(customToken!.addr)}
                    </span>
                  </span>
                  {address && (
                    <span className="text-sm text-white/50">
                      {bal.toLocaleString(undefined, {
                        maximumFractionDigits: 4,
                      })}
                    </span>
                  )}
                </button>
              );
            })()}
            {localFiltered.map((addr) => {
              const idx = OPTIONS.indexOf(addr);
              const bal = balances?.[idx]?.result as bigint | undefined;
              const dec = getTokenDecimals(addr);
              const balStr = bal
                ? formatUnits(bal, dec)
                : "0";

              return (
                <button
                  key={addr}
                  type="button"
                  onClick={() => {
                    onChange(addr);
                    setOpen(false);
                  }}
                  className="flex w-full items-center justify-between px-4 py-2 text-left text-white hover:bg-white/10"
                >
                  <span>
                    {getTokenSymbol(addr)}{" "}
                    <span className="text-white/40">{shortAddr(addr)}</span>
                  </span>
                  {address && (
                    <span className="text-sm text-white/50">
                      {Number(balStr).toLocaleString(undefined, {
                        maximumFractionDigits: 4,
                      })}
                    </span>
                  )}
                </button>
              );
            })}
            {globalTokens.map((t, i) => {
              const balResult = globalBalancesData?.[i * 2]?.result as
                | bigint
                | undefined;
              const decResult = globalBalancesData?.[i * 2 + 1]?.result as
                | number
                | undefined;
              const dec = typeof decResult === "number" ? decResult : 18;
              const balStr = balResult
                ? formatUnits(balResult, dec)
                : "0";
              return (
                <button
                  key={t.address}
                  type="button"
                  onClick={() => {
                    onChange(t.address);
                    setOpen(false);
                  }}
                  className="flex w-full items-center justify-between px-4 py-2 text-left text-white hover:bg-white/10"
                >
                  <span>
                    {t.symbol}{" "}
                    <span className="text-white/40">{shortAddr(t.address)}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    {address && (
                      <span className="text-sm text-white/50">
                        {Number(balStr).toLocaleString(undefined, {
                          maximumFractionDigits: 4,
                        })}
                      </span>
                    )}
                    <span className="text-xs text-white/40">Base</span>
                  </span>
                </button>
              );
            })}
            {!hasResults && (
              <div className="px-4 py-6 text-center text-white/50">
                {search.length < 2
                  ? "Enter at least 2 characters"
                  : isFetching
                    ? "Searching…"
                    : "Token not found"}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
