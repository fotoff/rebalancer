"use client";

import { Button } from "@/components/ui/button";

type DirectionToggleProps = {
  fromSym: string;
  toSym: string;
  direction: "1to2" | "2to1";
  onChange: (d: "1to2" | "2to1") => void;
  displayRatio: number;
};

export function DirectionToggle({
  fromSym,
  toSym,
  direction,
  onChange,
  displayRatio,
}: DirectionToggleProps) {
  const toggle = () => {
    onChange(direction === "1to2" ? "2to1" : "1to2");
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        onClick={toggle}
        className="flex items-center gap-2 px-4 py-2.5 font-medium"
      >
        <span>
          {fromSym} → {toSym}
        </span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="opacity-70"
        >
          <path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
        </svg>
      </Button>

      <div className="text-sm text-muted-foreground">
        1 {fromSym} ={" "}
        <span className="font-semibold text-foreground">
          {displayRatio.toLocaleString(undefined, { maximumFractionDigits: 4 })}
        </span>{" "}
        {toSym}
      </div>
    </div>
  );
}
