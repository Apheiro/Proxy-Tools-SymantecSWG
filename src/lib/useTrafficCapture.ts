'use client';

import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type {
  TrafficDataset,
  TrafficProcessingConfig,
} from './trafficAnalysis';
import type { CaptureArchive } from './trafficCapture';

export default function useTrafficCapture() {
  const [dataset, setDataset] = useState<TrafficDataset | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{
    name: string;
    percent: number;
    records: number;
    error?: string;
  } | null>(null);
  const [archives, setArchives] = useState<CaptureArchive[]>([]);
  const [config, setConfig] =
    useState<TrafficProcessingConfig | null>(null);
  const pending = useRef<string | null>(null);
  const mounted = useRef(true);
  const refreshArchives = useCallback(
    async () =>
      setArchives(
        await invoke<CaptureArchive[]>('list_traffic_analyses'),
      ),
    [],
  );
  useEffect(() => {
    mounted.current = true;
    void refreshArchives().catch((error) =>
      toast.error(String(error)),
    );
    void invoke<TrafficProcessingConfig>(
      'get_traffic_processing_config',
    )
      .then(setConfig)
      .catch((error) => toast.error(String(error)));
    return () => {
      mounted.current = false;
      if (pending.current)
        void invoke('abort_access_log_parse', {
          parseId: pending.current,
        }).catch(() => {});
    };
  }, [refreshArchives]);
  const discard = useCallback(async () => {
    const id = pending.current;
    pending.current = null;
    if (id) await invoke('abort_access_log_parse', { parseId: id });
  }, []);
  const loadFiles = async (files: File[], workers: number) => {
    if (busy || !files.length) return;
    const source =
      files.length === 1
        ? files[0].name
        : `${files.length} logs: ${files.map((file) => file.name).join(', ')}`;
    const totalSize = files.reduce(
      (total, file) => total + file.size,
      0,
    );
    setBusy(true);
    setDataset(null);
    setProgress({ name: source, percent: 0, records: 0 });
    let id: string | null = null;
    try {
      await discard();
      const processing =
        config ??
        (await invoke<TrafficProcessingConfig>(
          'get_traffic_processing_config',
        ));
      id = await invoke<string>('start_access_log_parse', {
        source,
        workers: workers || null,
      });
      pending.current = id;
      if (!mounted.current)
        throw new Error(
          'File processing cancelled because the page was closed.',
        );
      const chunkSize = processing.chunkBytes;
      let completedBytes = 0;
      let lastPaint = 0;
      for (const [fileIndex, file] of files.entries()) {
        const decoder = new TextDecoder();
        const read = (offset: number) =>
          file
            .slice(offset, offset + chunkSize)
            .arrayBuffer()
            .then(
              (buffer) => ({ buffer, error: null }),
              (error) => ({ buffer: null, error }),
            );
        let next = read(0);
        let offset = 0;
        do {
          if (!mounted.current)
            throw new Error(
              'File processing cancelled because the page was closed.',
            );
          const buffer = await next;
          if (buffer.error || !buffer.buffer)
            throw (
              buffer.error ??
              new Error('Could not read the log file.')
            );
          const end = Math.min(offset + chunkSize, file.size);
          const fileEnd = end >= file.size;
          const final = fileEnd && fileIndex === files.length - 1;
          if (!fileEnd) next = read(end);
          const result = await invoke<TrafficDataset>(
            'append_access_log_parse_chunk',
            {
              parseId: id,
              chunk: decoder.decode(buffer.buffer, {
                stream: !fileEnd,
              }),
              isFinal: final,
              fileSource: file.name,
              isFileStart: offset === 0,
              isFileEnd: fileEnd,
            },
          );
          offset = end;
          if (fileEnd || performance.now() - lastPaint > 500) {
            setDataset(result);
            setProgress({
              name:
                files.length === 1
                  ? file.name
                  : `${fileIndex + 1}/${files.length} · ${file.name}`,
              percent: final
                ? 100
                : totalSize
                  ? Math.round(
                      ((completedBytes + end) * 100) / totalSize,
                    )
                  : 0,
              records: result.recordsProcessed,
            });
            lastPaint = performance.now();
          }
          if (fileEnd) break;
        } while (offset < file.size);
        completedBytes += file.size;
      }
      toast.success(
        files.length === 1
          ? `Indexed all records in ${source}.`
          : `Indexed ${files.length} logs into one capture.`,
      );
    } catch (error) {
      if (id) {
        await invoke('abort_access_log_parse', { parseId: id }).catch(
          () => {},
        );
        pending.current = null;
      }
      if (mounted.current) {
        setDataset(null);
        setProgress((current) =>
          current ? { ...current, error: String(error) } : null,
        );
        toast.error(
          `Could not process the selected logs: ${String(error)}`,
        );
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const loadFile = (file: File, workers: number) =>
    loadFiles([file], workers);
  const loadSaved = async (id: string) => {
    if (!id || busy) return;
    setBusy(true);
    try {
      const result = await invoke<TrafficDataset>(
        'load_traffic_analysis',
        { id },
      );
      await discard();
      setDataset(result);
      setProgress(null);
      toast.success('Loaded the full indexed capture.');
    } catch (error) {
      toast.error(`Could not load capture: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };
  const save = async (captureId: string) => {
    setBusy(true);
    try {
      const path = await invoke<string>('save_traffic_analysis', {
        parseId: captureId,
      });
      await refreshArchives();
      toast.success('Capture and counters saved.', {
        description: path,
      });
      return true;
    } catch (error) {
      toast.error(`Could not save capture: ${String(error)}`);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return {
    dataset,
    setDataset,
    busy,
    progress,
    archives,
    config,
    discard,
    loadFile,
    loadFiles,
    loadSaved,
    save,
  };
}
