'use client';

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type EnhancerSettings = {
  exposure: number;
  contrast: number;
  saturation: number;
  temperature: number;
  shadowLift: number;
  highlightRecover: number;
  clarity: number;
  smoothness: number;
  resolutionBoost: number;
};

type SliderProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (value: number) => string;
  onChange: (value: number) => void;
};

const DEFAULT_SETTINGS: EnhancerSettings = {
  exposure: 1.08,
  contrast: 1.12,
  saturation: 1.18,
  temperature: 10,
  shadowLift: 0.2,
  highlightRecover: 0.16,
  clarity: 0.22,
  smoothness: 0.08,
  resolutionBoost: 1.3,
};

const SAMPLE_IMAGE =
  "https://images.unsplash.com/photo-1531891437562-4301cf35b7e4?auto=format&fit=crop&w=1600&q=80";

function SliderControl({
  label,
  value,
  min,
  max,
  step = 0.01,
  format = (val) => val.toFixed(2),
  onChange,
}: SliderProps) {
  return (
    <label className="slider">
      <div className="slider-header">
        <span>{label}</span>
        <span className="slider-value">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(parseFloat(event.target.value))}
      />
    </label>
  );
}

export default function Home() {
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [enhancedUrl, setEnhancedUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState("enhanced-photo.jpg");
  const [settings, setSettings] = useState<EnhancerSettings>(DEFAULT_SETTINGS);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasImage, setHasImage] = useState(false);

  const bitmapRef = useRef<ImageBitmap | null>(null);
  const processingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const debounceRef = useRef<number | null>(null);

  const ensureCanvas = useCallback(() => {
    if (!processingCanvasRef.current) {
      processingCanvasRef.current = document.createElement("canvas");
    }
    if (!previewCanvasRef.current) {
      const canvas = document.createElement("canvas");
      canvas.className = "preview-canvas";
      previewCanvasRef.current = canvas;
    }
    return {
      processing: processingCanvasRef.current,
      preview: previewCanvasRef.current,
    };
  }, []);

  const resetBitmaps = useCallback(() => {
    if (bitmapRef.current) {
      try {
        bitmapRef.current.close();
      } catch {
        // Older browsers might not provide close
      }
    }
    bitmapRef.current = null;
  }, []);

  const clamp = useCallback((val: number) => Math.max(0, Math.min(255, val)), []);

  const recalculateImage = useCallback(async () => {
    if (!bitmapRef.current || !hasImage) {
      return;
    }
    setIsProcessing(true);
    setErrorMessage(null);

    try {
      const { processing, preview } = ensureCanvas();
      const context = processing.getContext("2d", { willReadFrequently: true });
      const previewContext = preview.getContext("2d");

      if (!context || !previewContext) {
        throw new Error("Could not prepare the enhancement canvas.");
      }

      const { exposure, contrast, saturation, resolutionBoost } = settings;
      const width = Math.max(1, Math.round(bitmapRef.current.width * resolutionBoost));
      const height = Math.max(1, Math.round(bitmapRef.current.height * resolutionBoost));

      processing.width = width;
      processing.height = height;
      preview.width = width;
      preview.height = height;

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.filter = `brightness(${exposure}) contrast(${contrast}) saturate(${saturation})`;
      context.drawImage(bitmapRef.current, 0, 0, width, height);

      let imageData = context.getImageData(0, 0, width, height);
      const { data } = imageData;
      const { temperature, shadowLift, highlightRecover, clarity, smoothness } = settings;

      const requiresBlur = clarity !== 0 || smoothness !== 0;
      const blurred = requiresBlur ? new Uint8ClampedArray(data.length) : null;

      if (requiresBlur && blurred) {
        const kernelRadius = 1;

        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            let rSum = 0;
            let gSum = 0;
            let bSum = 0;
            let count = 0;

            for (let dy = -kernelRadius; dy <= kernelRadius; dy += 1) {
              for (let dx = -kernelRadius; dx <= kernelRadius; dx += 1) {
                const nx = x + dx;
                const ny = y + dy;

                if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                  const index = (ny * width + nx) * 4;
                  rSum += data[index];
                  gSum += data[index + 1];
                  bSum += data[index + 2];
                  count += 1;
                }
              }
            }

            const idx = (y * width + x) * 4;
            blurred[idx] = rSum / count;
            blurred[idx + 1] = gSum / count;
            blurred[idx + 2] = bSum / count;
            blurred[idx + 3] = 255;
          }
        }
      }

      for (let i = 0; i < data.length; i += 4) {
        const rIndex = i;
        const gIndex = i + 1;
        const bIndex = i + 2;

        let r = data[rIndex];
        let g = data[gIndex];
        let b = data[bIndex];

        const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const normalizedLum = luminance / 255;

        if (shadowLift !== 0) {
          const lift = 1 + shadowLift * Math.max(0, (0.5 - normalizedLum) * 2);
          r *= lift;
          g *= lift;
          b *= lift;
        }

        if (highlightRecover !== 0) {
          const recover = 1 - highlightRecover * Math.max(0, (normalizedLum - 0.5) * 2);
          r *= recover;
          g *= recover;
          b *= recover;
        }

        if (temperature !== 0) {
          const normalizedTemp = temperature / 100;
          if (normalizedTemp > 0) {
            r = r + normalizedTemp * (255 - r) * 0.22;
            g = g + normalizedTemp * (255 - g) * 0.08;
            b = b * (1 - normalizedTemp * 0.15);
          } else {
            const cool = -normalizedTemp;
            b = b + cool * (255 - b) * 0.25;
            g = g + cool * (255 - g) * 0.04;
            r = r * (1 - cool * 0.18);
          }
        }

        if (requiresBlur && blurred) {
          const br = blurred[rIndex];
          const bg = blurred[gIndex];
          const bb = blurred[bIndex];

          if (clarity !== 0) {
            const boost = 1 + clarity * 1.6;
            r = br + (r - br) * boost;
            g = bg + (g - bg) * boost;
            b = bb + (b - bb) * boost;
          }

          if (smoothness !== 0) {
            const smoothFactor = smoothness * 0.85;
            r = r * (1 - smoothFactor) + br * smoothFactor;
            g = g * (1 - smoothFactor) + bg * smoothFactor;
            b = b * (1 - smoothFactor) + bb * smoothFactor;
          }
        }

        data[rIndex] = clamp(r);
        data[gIndex] = clamp(g);
        data[bIndex] = clamp(b);
      }

      context.putImageData(imageData, 0, 0);
      previewContext.imageSmoothingQuality = "high";
      previewContext.drawImage(processing, 0, 0);

      const result = preview.toDataURL("image/jpeg", 0.94);
      setEnhancedUrl(result);
    } catch (error) {
      if (error instanceof Error) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage("Unexpected error while enhancing this photo.");
      }
    } finally {
      setIsProcessing(false);
    }
  }, [clamp, ensureCanvas, hasImage, settings]);

  const handleFile = useCallback(
    async (file: File) => {
      setErrorMessage(null);

      try {
        if (sourceUrl) {
          URL.revokeObjectURL(sourceUrl);
        }

        const objectUrl = URL.createObjectURL(file);
        setSourceUrl(objectUrl);
        setHasImage(true);

        const safeName = file.name.replace(/\.[^/.]+$/, "");
        setFileName(`${safeName || "portrait"}-enhanced.jpg`);

        resetBitmaps();
        const bitmap = await createImageBitmap(file);
        bitmapRef.current = bitmap;
        await recalculateImage();
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : "Could not load the selected image."
        );
      }
    },
    [recalculateImage, resetBitmaps, sourceUrl]
  );

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }
      await handleFile(file);
    },
    [handleFile]
  );

  const handleSample = useCallback(async () => {
    setErrorMessage(null);
    setIsProcessing(true);
    try {
      const response = await fetch(SAMPLE_IMAGE, { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Could not download sample portrait.");
      }

      const blob = await response.blob();
      const sampleFile = new File([blob], "sample-portrait.jpg", { type: blob.type });
      await handleFile(sampleFile);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to load sample portrait."
      );
    } finally {
      setIsProcessing(false);
    }
  }, [handleFile]);

  const handleDownload = useCallback(() => {
    if (!enhancedUrl) {
      return;
    }
    const anchor = document.createElement("a");
    anchor.href = enhancedUrl;
    anchor.download = fileName;
    anchor.click();
  }, [enhancedUrl, fileName]);

  const updateSetting = useCallback(
    (key: keyof EnhancerSettings, value: number) => {
      setSettings((prev) => ({
        ...prev,
        [key]: value,
      }));

      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }

      debounceRef.current = window.setTimeout(() => {
        recalculateImage();
      }, 120);
    },
    [recalculateImage]
  );

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
    recalculateImage();
  }, [recalculateImage]);

  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
      if (sourceUrl) {
        URL.revokeObjectURL(sourceUrl);
      }
      resetBitmaps();
    };
  }, [resetBitmaps, sourceUrl]);

  const hasEnhancedImage = useMemo(() => Boolean(enhancedUrl && hasImage), [enhancedUrl, hasImage]);

  return (
    <div className="page">
      <div className="background-glow" aria-hidden="true" />
      <main className="app-shell">
        <header className="hero">
          <div>
            <h1>Hi-Res Portrait Enhancer</h1>
            <p>
              Upload a portrait and transform it with studio-grade lighting, vibrant color,
              and intelligent tone recovery. Download a refined, high-resolution version in seconds.
            </p>
            <div className="hero-actions">
              <label className="upload-button">
                <input type="file" accept="image/*" onChange={handleFileChange} />
                <span>Upload your photo</span>
              </label>
              <button className="secondary-button" onClick={handleSample}>
                Try sample portrait
              </button>
            </div>
          </div>
        </header>

        <section className="workspace">
          <div className="preview-card">
            {hasEnhancedImage && enhancedUrl ? (
              <img src={enhancedUrl} alt="Enhanced portrait preview" />
            ) : (
              <div className="placeholder">
                <span>No portrait selected</span>
                <p>Upload your photo or explore the built-in sample to get started.</p>
              </div>
            )}
            {hasEnhancedImage && (
              <div className="preview-actions">
                <button className="primary-button" onClick={handleDownload} disabled={isProcessing}>
                  Download high-quality JPEG
                </button>
                <button className="ghost-button" onClick={resetSettings} disabled={isProcessing}>
                  Reset adjustments
                </button>
              </div>
            )}
          </div>

          <aside className="controls">
            <h2>Enhancement Controls</h2>
            <p className="controls-description">
              Fine-tune the rendering to match your style. Every slider updates the live high-resolution
              preview.
            </p>

            <div className="slider-grid">
              <SliderControl
                label="Exposure"
                value={settings.exposure}
                min={0.6}
                max={1.8}
                step={0.01}
                onChange={(value) => updateSetting("exposure", value)}
              />
              <SliderControl
                label="Contrast"
                value={settings.contrast}
                min={0.6}
                max={1.8}
                step={0.01}
                onChange={(value) => updateSetting("contrast", value)}
              />
              <SliderControl
                label="Saturation"
                value={settings.saturation}
                min={0.3}
                max={2}
                step={0.01}
                onChange={(value) => updateSetting("saturation", value)}
              />
              <SliderControl
                label="Temperature"
                value={settings.temperature}
                min={-40}
                max={40}
                step={1}
                format={(val) => `${val}K`}
                onChange={(value) => updateSetting("temperature", value)}
              />
              <SliderControl
                label="Shadow lift"
                value={settings.shadowLift}
                min={0}
                max={0.6}
                step={0.01}
                onChange={(value) => updateSetting("shadowLift", value)}
              />
              <SliderControl
                label="Highlight recovery"
                value={settings.highlightRecover}
                min={0}
                max={0.6}
                step={0.01}
                onChange={(value) => updateSetting("highlightRecover", value)}
              />
              <SliderControl
                label="Clarity"
                value={settings.clarity}
                min={0}
                max={0.5}
                step={0.01}
                onChange={(value) => updateSetting("clarity", value)}
              />
              <SliderControl
                label="Smoothness"
                value={settings.smoothness}
                min={0}
                max={0.5}
                step={0.01}
                onChange={(value) => updateSetting("smoothness", value)}
              />
              <SliderControl
                label="Resolution boost"
                value={settings.resolutionBoost}
                min={1}
                max={2}
                step={0.05}
                format={(val) => `${(val * 100).toFixed(0)}%`}
                onChange={(value) => updateSetting("resolutionBoost", value)}
              />
            </div>

            <div className="status">
              {isProcessing && <span className="status-badge processing">Enhancing…</span>}
              {!isProcessing && hasEnhancedImage && (
                <span className="status-badge ready">Ready to download</span>
              )}
              {errorMessage && <span className="status-badge error">{errorMessage}</span>}
            </div>
          </aside>
        </section>
      </main>
    </div>
  );
}
