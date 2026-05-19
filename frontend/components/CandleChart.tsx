"use client";

// THE Phase 4 lesson: lightweight-charts is an *imperative* canvas library —
// it is not React. You don't render it with JSX; you create it, command it
// ("set this data"), and must destroy it yourself. React is *declarative*.
// The bridge is useEffect:
//   • create the chart ONCE when the element mounts
//   • feed it data
//   • return a cleanup function that destroys it on unmount
// Skipping that cleanup is the #1 cause of chart memory leaks: every reload
// would stack a new orphaned chart on top of the old one.

import {
  CandlestickData,
  ColorType,
  HistogramData,
  LineData,
  createChart,
} from "lightweight-charts";
import { useEffect, useRef } from "react";

import type { Candle } from "@/lib/api";

export type Overlay = {
  label: string;
  color: string;
  data: { time: string; value: number }[];
};

export default function CandleChart({
  candles,
  overlays = [],
}: {
  candles: Candle[];
  overlays?: Overlay[];
}) {
  // A ref = a stable handle to the real DOM <div> that React owns but the
  // chart library draws into. Refs don't trigger re-renders; perfect for
  // handing a plain DOM node to a non-React library.
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#0a0a0b" },
        textColor: "#9ca3af",
      },
      grid: {
        vertLines: { color: "#1f1f23" },
        horzLines: { color: "#1f1f23" },
      },
      rightPriceScale: { borderColor: "#1f1f23" },
      timeScale: { borderColor: "#1f1f23" },
      autoSize: true, // chart tracks the container's size on its own
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: "#10b981",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#10b981",
      wickDownColor: "#ef4444",
    });
    candleSeries.setData(candles as CandlestickData[]);

    // Volume as a second series, drawn small at the bottom on its own scale.
    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
    });
    chart.priceScale("vol").applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 }, // squeeze into bottom 15%
    });
    volumeSeries.setData(
      candles.map(
        (c): HistogramData => ({
          time: c.time,
          value: c.volume,
          color: c.close >= c.open ? "#10b98155" : "#ef444455",
        }),
      ),
    );

    // Optional MA overlay lines. When the toggle is OFF the parent passes an
    // empty array, so the chart is drawn clean — no special "remove series"
    // code needed because turning it off re-runs this whole effect from
    // scratch (chart.remove() in cleanup wipes everything first).
    for (const ov of overlays) {
      const line = chart.addLineSeries({
        color: ov.color,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      line.setData(ov.data as LineData[]);
    }

    chart.timeScale().fitContent();

    // Cleanup: runs on unmount OR before the effect re-runs (candles OR
    // overlays change). This single line is the whole leak-prevention story.
    return () => chart.remove();
  }, [candles, overlays]); // re-create when data OR overlays change

  // h-full so the chart fills whatever pane the workspace gives it (autoSize
  // on the chart tracks this element's size). min-h lowered to 200 so a
  // user-shrunk workspace stays usable instead of overflowing its pane.
  return <div ref={containerRef} className="h-full min-h-[200px] w-full" />;
}
