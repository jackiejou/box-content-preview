import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import noop from 'lodash/noop';
import throttle from 'lodash/throttle';
import HighResThumbnailStore from './HighResThumbnailStore';
import {
    CONCURRENT_LOADS,
    GALLERY_HIGH_RES_CONCURRENCY,
    GALLERY_HIGH_RES_MAX_BYTES,
    GALLERY_HIGH_RES_MAX_PAGES,
    GALLERY_THUMB_MAX_DPR,
    GALLERY_THUMB_MAX_TIER,
    GALLERY_THUMB_MAX_WIDTH,
    GALLERY_THUMB_WIDTH_TIERS,
    SCROLL_THROTTLE_MS,
} from './constants';
import useGalleryPinch, { PinchDirection, PinchFocal } from './useGalleryPinch';
import { GalleryThumbnail, GalleryTileLayout } from './types';

type Options = {
    /** Topmost visible page, kept current on scroll; the scroll anchor restored after a reflow. */
    anchorPageRef: React.MutableRefObject<number>;
    currentPage: number;
    /** The scroll container; every tile inside it carries a data-page attribute. */
    gridRef: React.RefObject<HTMLDivElement>;
    /** The CSS grid whose columns zoom resizes. */
    innerRef: React.RefObject<HTMLDivElement>;
    isPinchZoomEnabled: boolean;
    isTouchZoomEnabled: boolean;
    /** Runs right after mount centers and focuses the current page tile, when that tile has rendered by then. */
    onInitialTileFocus?: (tile: HTMLElement) => void;
    /** Runs after every layout mutation: mount, container resize, and zoom changes. */
    onLayoutChange?: () => void;
    onPinchStart: (direction: PinchDirection) => void;
    onScaleChange: (scale: number) => boolean | void;
    pageCount: number;
    scale: number;
    thumbnail: GalleryThumbnail;
    /** Track sizing of the grid at 100% zoom; a function is resolved against the grid each time zoom lays it out. */
    tileLayout: GalleryTileLayout | ((inner: HTMLElement) => GalleryTileLayout);
};

type GalleryGridState = {
    handleScroll: () => void;
    highResImages: Record<number, string>;
    loadedImages: Record<number, string>;
    pageRatio: number | null;
};

export default function useGalleryGrid({
    anchorPageRef,
    currentPage,
    gridRef,
    innerRef,
    isPinchZoomEnabled,
    isTouchZoomEnabled,
    onInitialTileFocus = noop,
    onLayoutChange = noop,
    onPinchStart,
    onScaleChange,
    pageCount,
    scale,
    thumbnail,
    tileLayout,
}: Options): GalleryGridState {
    const [loadedImages, setLoadedImages] = useState<Record<number, string>>({});
    const [highResImages, setHighResImages] = useState<Record<number, string>>({});
    const [pageRatio, setPageRatio] = useState<number | null>(null);
    const focalRef = useRef<PinchFocal | null>(null);
    const scaleRef = useRef(scale);
    const queueRef = useRef<number[]>([]);
    const isProcessingRef = useRef(false);
    const isMountedRef = useRef(true);
    const inFlightRef = useRef<Set<number>>(new Set());
    const highResStoreRef = useRef<HighResThumbnailStore | null>(null);

    const byDistanceFromAnchor = (a: number, b: number): number =>
        Math.abs(a - anchorPageRef.current) - Math.abs(b - anchorPageRef.current);

    function getNeededThumbWidth(): number {
        if (scaleRef.current === 1) {
            return GALLERY_THUMB_MAX_WIDTH;
        }

        const tile = gridRef.current?.querySelector<HTMLElement>('[data-page]');
        const neededWidth = (tile?.offsetWidth || 0) * Math.min(window.devicePixelRatio || 1, GALLERY_THUMB_MAX_DPR);
        return GALLERY_THUMB_WIDTH_TIERS.find(tier => tier >= neededWidth) || GALLERY_THUMB_MAX_TIER;
    }

    // Prioritize visible pages before spending work on the surrounding buffer.
    function getPagesNearViewport(
        marginRatio: number,
        isEligible?: (tile: HTMLElement, pageNum: number) => boolean,
    ): number[] {
        const grid = gridRef.current;
        if (!grid) return [];

        const { scrollTop, clientHeight } = grid;
        const viewportBottom = scrollTop + clientHeight;
        const margin = clientHeight * marginRatio;
        const visible: number[] = [];
        const nearby: number[] = [];

        grid.querySelectorAll<HTMLElement>('[data-page]').forEach(tile => {
            if (!tile.dataset.page) return;
            const pageNum = parseInt(tile.dataset.page, 10);
            if (isEligible && !isEligible(tile, pageNum)) return;
            const tileTop = tile.offsetTop;
            const tileBottom = tileTop + tile.offsetHeight;

            if (tileBottom > scrollTop && tileTop < viewportBottom) {
                visible.push(pageNum);
            } else if (tileBottom > scrollTop - margin && tileTop < viewportBottom + margin) {
                nearby.push(pageNum);
            }
        });

        return [...visible.sort(byDistanceFromAnchor), ...nearby.sort(byDistanceFromAnchor)];
    }

    function syncHighRes() {
        const store = highResStoreRef.current;
        const { pageRatio: thumbnailPageRatio } = thumbnail;
        if (!store || !thumbnailPageRatio) return;

        const width = getNeededThumbWidth();
        if (width === GALLERY_THUMB_MAX_WIDTH) {
            store.setRetained([], width, thumbnailPageRatio);
        } else if (!isProcessingRef.current) {
            store.setRetained(getPagesNearViewport(0.5), width, thumbnailPageRatio);
        }
    }

    function getUnloadedNearViewport(): number[] {
        return getPagesNearViewport(
            3,
            (tile, pageNum) => !inFlightRef.current.has(pageNum) && !tile.querySelector('img'),
        );
    }

    function processQueue() {
        if (!isMountedRef.current || !thumbnail || queueRef.current.length === 0) {
            isProcessingRef.current = false;
            return;
        }

        const batch = queueRef.current.slice(0, CONCURRENT_LOADS);
        queueRef.current = queueRef.current.slice(CONCURRENT_LOADS);

        requestAnimationFrame(() => {
            if (!isMountedRef.current || !thumbnail) {
                isProcessingRef.current = false;
                return;
            }

            let completed = 0;

            const onComplete = () => {
                completed += 1;
                if (completed < batch.length) return;

                if (!isMountedRef.current) {
                    isProcessingRef.current = false;
                    return;
                }

                // Keep only what the viewport + buffer still needs, then go idle. This prune is
                // what makes loading lazy (the mount queue starts as the whole document); the
                // scroll/resize handlers re-derive what to load on demand after that.
                const remaining = new Set(queueRef.current);
                queueRef.current = getUnloadedNearViewport().filter(p => remaining.has(p));
                if (queueRef.current.length === 0) {
                    isProcessingRef.current = false;
                    syncHighRes();
                    return;
                }
                processQueue();
            };

            batch.forEach(pageNum => {
                inFlightRef.current.add(pageNum);
                thumbnail
                    .createThumbnailImage(pageNum - 1, { createImgTag: true, thumbMaxWidth: GALLERY_THUMB_MAX_WIDTH })
                    .then((imageEl: HTMLImageElement | null) => {
                        inFlightRef.current.delete(pageNum);
                        if (isMountedRef.current && imageEl && imageEl.src) {
                            setLoadedImages(prev => ({ ...prev, [pageNum]: imageEl.src }));
                        }
                        onComplete();
                    })
                    .catch(() => {
                        inFlightRef.current.delete(pageNum);
                        onComplete();
                    });
            });
        });
    }

    function startProcessing() {
        if (!isProcessingRef.current && queueRef.current.length > 0) {
            isProcessingRef.current = true;
            processQueue();
        }
    }

    const handleScrollRef = useRef(
        throttle(() => {
            const nearbyUnloaded = getUnloadedNearViewport();
            if (nearbyUnloaded.length > 0) {
                const currentQueue = new Set(queueRef.current);
                const toAdd = nearbyUnloaded.filter(p => !currentQueue.has(p));
                queueRef.current = [...toAdd, ...queueRef.current];
                startProcessing();
            }
            syncHighRes();
        }, SCROLL_THROTTLE_MS),
    );

    // Unthrottled so the anchor is accurate the instant a reflow (e.g. fullscreen) happens.
    const handleScroll = useCallback(() => {
        const grid = gridRef.current;
        if (grid) {
            const tiles = grid.querySelectorAll<HTMLElement>('[data-page]');
            for (let i = 0; i < tiles.length; i += 1) {
                if (tiles[i].offsetTop + tiles[i].offsetHeight > grid.scrollTop) {
                    const { page } = tiles[i].dataset;
                    if (page) {
                        anchorPageRef.current = parseInt(page, 10);
                    }
                    break;
                }
            }
        }
        handleScrollRef.current();
    }, [anchorPageRef, gridRef]);

    useGalleryPinch({
        focalRef,
        gridRef,
        isPinchZoomEnabled,
        isTouchZoomEnabled,
        onGestureStart: onPinchStart,
        onZoom: onScaleChange,
        scaleRef,
    });

    const applyZoomLayout = useCallback(() => {
        const inner = innerRef.current;
        if (!inner) {
            return;
        }

        const currentScale = scaleRef.current;
        inner.style.setProperty('--bp-gallery-hover-scale', String(1 + 0.02 / currentScale));

        if (currentScale === 1) {
            inner.style.gridTemplateColumns = '';
            inner.style.justifyContent = '';
            return;
        }

        const { gapPx, minWidthPx } = typeof tileLayout === 'function' ? tileLayout(inner) : tileLayout;
        const width = inner.clientWidth;
        const columns = Math.max(1, Math.floor((width + gapPx) / (minWidthPx + gapPx)));
        const baseWidth = (width - (columns - 1) * gapPx) / columns;
        inner.style.gridTemplateColumns = `repeat(auto-fill, ${Math.min(width, baseWidth * currentScale)}px)`;
        inner.style.justifyContent = 'center';
    }, [innerRef, tileLayout]);

    useLayoutEffect(() => {
        const grid = gridRef.current;
        const previousScale = scaleRef.current;
        scaleRef.current = scale;

        const focal = focalRef.current;
        focalRef.current = null;

        if (!grid || previousScale === scale) {
            applyZoomLayout();
            onLayoutChange();
            return;
        }

        const focalTile = focal
            ? document.elementFromPoint?.(focal.x, focal.y)?.closest<HTMLElement>('[data-page]')
            : null;
        const anchorTile = focalTile || grid.querySelector<HTMLElement>(`[data-page="${anchorPageRef.current}"]`);
        const beforeRect = anchorTile && anchorTile.getBoundingClientRect();

        applyZoomLayout();

        if (anchorTile && beforeRect) {
            const afterRect = anchorTile.getBoundingClientRect();
            grid.scrollLeft += afterRect.left - beforeRect.left;
            grid.scrollTop += afterRect.top - beforeRect.top;
        }

        handleScrollRef.current();
        onLayoutChange();
    }, [anchorPageRef, applyZoomLayout, gridRef, onLayoutChange, scale]);

    useEffect(() => {
        const throttledScroll = handleScrollRef.current;
        const highResStore = new HighResThumbnailStore({
            maxBytes: GALLERY_HIGH_RES_MAX_BYTES,
            maxConcurrent: GALLERY_HIGH_RES_CONCURRENCY,
            maxPages: GALLERY_HIGH_RES_MAX_PAGES,
            onChange: images => {
                if (isMountedRef.current) {
                    setHighResImages(images);
                }
            },
            render: (pageNum, width) => thumbnail.renderPageImage(pageNum, { thumbMaxWidth: width }),
        });
        highResStoreRef.current = highResStore;

        if (gridRef.current) {
            const tile = gridRef.current.querySelector(`[data-page="${currentPage}"]`) as HTMLElement;
            if (tile) {
                tile.scrollIntoView({ block: 'center' });
                tile.focus();
                onInitialTileFocus(tile);
            }
        }

        const initialImages: Record<number, string> = {};
        const uncachedPages: number[] = [];

        for (let i = 1; i <= pageCount; i += 1) {
            const cached = thumbnail.getImageFromCache(i - 1);
            if (cached && cached.image && cached.image.src) {
                initialImages[i] = cached.image.src;
            } else {
                uncachedPages.push(i);
            }
        }

        if (Object.keys(initialImages).length > 0) {
            setLoadedImages(initialImages);
        }

        uncachedPages.sort((a, b) => Math.abs(a - currentPage) - Math.abs(b - currentPage));
        queueRef.current = uncachedPages;

        thumbnail.init().then(() => {
            if (!isMountedRef.current) return;
            if (typeof thumbnail.pageRatio === 'number' && thumbnail.pageRatio > 0) {
                setPageRatio(thumbnail.pageRatio);
            }
            // Guarded start: the mount scrollIntoView can fire the scroll handler first, and a
            // second unguarded pump would double the concurrent thumbnail renders.
            startProcessing();
            syncHighRes();
        });

        return () => {
            isMountedRef.current = false;
            queueRef.current = [];
            isProcessingRef.current = false;
            highResStore.destroy();
            highResStoreRef.current = null;
            throttledScroll.cancel();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Keep the viewed area in place when the grid reflows (fullscreen enter/exit, window resize):
    // the scroll offset is preserved while tile positions shift, drifting the view otherwise.
    useEffect(() => {
        const grid = gridRef.current;
        if (!grid) return undefined;

        let isFirstObservation = true;
        const observer = new ResizeObserver(() => {
            // The first observe() delivery can report a size the mount layout never saw, so re-apply
            // layout and notify; skip only the anchor restore, since nothing is viewed yet.
            applyZoomLayout();
            if (isFirstObservation) {
                isFirstObservation = false;
                onLayoutChange();
                return;
            }
            const tile = grid.querySelector(`[data-page="${anchorPageRef.current}"]`) as HTMLElement | null;
            if (tile) {
                tile.scrollIntoView({ block: 'start' });
            }
            // Notify after the anchor restore so a layout consumer measures the restored position.
            onLayoutChange();
            // A larger viewport (fullscreen enter, window resize) can reveal unloaded tiles
            // without any scroll event, so run the same catch-up the scroll handler does.
            handleScrollRef.current();
        });
        observer.observe(grid);

        return () => observer.disconnect();
    }, [anchorPageRef, applyZoomLayout, gridRef, onLayoutChange]);

    return { handleScroll, highResImages, loadedImages, pageRatio };
}
