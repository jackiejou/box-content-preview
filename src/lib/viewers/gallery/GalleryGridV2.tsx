import React, { useCallback, useMemo, useRef, useState } from 'react';
import noop from 'lodash/noop';
import { GridListV2, IconButton, Text, Tooltip } from '@box/blueprint-web';
import XMark from '@box/blueprint-web-assets/icons/Medium/XMark';
import { decodeKeydown, replacePlaceholders } from '../../util';
import { GALLERY_FALLBACK_PAGE_RATIO, GALLERY_V2_TILE_MIN_WIDTH_REM } from './constants';
import useGalleryGrid from './useGalleryGrid';
import { GalleryGridBaseProps, GalleryTileLayout } from './types';
import './GalleryGrid.scss';
import './GalleryGridV2.scss';

export type Props = GalleryGridBaseProps;

type TileProps = {
    firstPageRatio: number | null;
    imageSrc?: string;
    pageNum: number;
    pageRatio: number | null;
    tileRef?: React.Ref<HTMLDivElement>;
};

// Grid-nav keys stay inside the gallery even when the grid list cannot move, so they never
// reach the viewer's page navigation or scroll the overlay.
const CONTAINED_KEYS = new Set([
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'End',
    'Enter',
    'Home',
    'PageDown',
    'PageUp',
]);

const getTilePage = (target: EventTarget | null): number | null => {
    const tile = target instanceof Element ? target.closest<HTMLElement>('[data-page]') : null;
    return tile && tile.dataset.page ? parseInt(tile.dataset.page, 10) : null;
};

const getTileLayout = (inner: HTMLElement): GalleryTileLayout => ({
    gapPx: parseFloat(getComputedStyle(inner).columnGap) || 0,
    minWidthPx: GALLERY_V2_TILE_MIN_WIDTH_REM * parseFloat(getComputedStyle(document.documentElement).fontSize),
});

const GalleryTileV2 = React.memo(function GalleryTileV2({
    firstPageRatio,
    imageSrc,
    pageNum,
    pageRatio,
    tileRef,
}: TileProps): JSX.Element {
    const [imageRatio, setImageRatio] = useState<number | null>(null);
    const label = replacePlaceholders(__('page_gallery_tile'), [String(pageNum)]);
    const knownRatio = pageRatio || imageRatio || firstPageRatio;
    const ratio =
        knownRatio && Number.isFinite(knownRatio) && knownRatio > 0 ? knownRatio : GALLERY_FALLBACK_PAGE_RATIO;
    const thumbnailStyle = { '--grid-v2-thumbnail-aspect-ratio': String(ratio) } as React.CSSProperties;

    const handleImageLoad = useCallback((event: React.SyntheticEvent<HTMLImageElement>) => {
        const { naturalHeight, naturalWidth } = event.currentTarget;
        if (naturalWidth > 0 && naturalHeight > 0) {
            setImageRatio(naturalWidth / naturalHeight);
        }
    }, []);

    return (
        <GridListV2.Item
            ref={tileRef}
            data-page={pageNum}
            data-resin-target="galleryTile"
            id={pageNum}
            textValue={label}
        >
            <GridListV2.Thumbnail style={thumbnailStyle}>
                {imageSrc && <img alt="" onLoad={handleImageLoad} src={imageSrc} />}
            </GridListV2.Thumbnail>
            <GridListV2.Header textValue={label}>
                <Text as="span" variant="bodyDefaultSemibold">
                    {label}
                </Text>
            </GridListV2.Header>
        </GridListV2.Item>
    );
});

export default function GalleryGridV2({
    pageCount,
    currentPage,
    getPageRatio,
    isPinchZoomEnabled = false,
    isTouchZoomEnabled = false,
    onClose,
    onFocusChange,
    onPageNavigate,
    onPinchStart = noop,
    onScaleChange = noop,
    scale = 1,
    thumbnail,
}: Props): JSX.Element {
    const [focusedPage, setFocusedPage] = useState(currentPage);
    const anchorPageRef = useRef(currentPage);
    const gridRef = useRef<HTMLDivElement>(null);
    const innerRef = useRef<HTMLDivElement>(null);
    const selectedKeys = useMemo(() => [focusedPage], [focusedPage]);

    const { handleScroll, highResImages, loadedImages, pageRatio } = useGalleryGrid({
        anchorPageRef,
        currentPage,
        gridRef,
        innerRef,
        isPinchZoomEnabled,
        isTouchZoomEnabled,
        onPinchStart,
        onScaleChange,
        pageCount,
        scale,
        thumbnail,
        tileLayout: getTileLayout,
    });

    // The grid list commits its rows after mount, so the current page is centered and focused when its row attaches.
    const hasFocusedInitialTileRef = useRef(false);
    const focusInitialTile = useCallback((tile: HTMLDivElement | null) => {
        if (!tile || hasFocusedInitialTileRef.current) {
            return;
        }
        hasFocusedInitialTileRef.current = true;
        tile.scrollIntoView({ block: 'center' });
        tile.focus();
    }, []);

    const handleAction = useCallback(
        (key: string | number) => {
            if (typeof key === 'number') onPageNavigate(key);
        },
        [onPageNavigate],
    );

    const handleFocus = useCallback(
        (event: React.FocusEvent) => {
            const grid = gridRef.current;
            if (grid && event.target === grid) {
                grid.querySelector<HTMLElement>(`[data-page="${focusedPage}"]`)?.focus({ preventScroll: true });
                return;
            }

            const pageNum = getTilePage(event.target);
            if (pageNum !== null) {
                setFocusedPage(pageNum);
                if (onFocusChange) {
                    onFocusChange(pageNum);
                }
            }
        },
        [focusedPage, onFocusChange],
    );

    // Capture phase: the grid list swallows character keys and treats Space as select, so the
    // gallery's own shortcuts are resolved before the event reaches it.
    const handleKeyDownCapture = useCallback(
        (event: React.KeyboardEvent) => {
            const key = decodeKeydown(event);
            const tilePage = getTilePage(event.target);
            const isZoomKey = key === 'Shift++' || key === 'Shift+_';

            if (key === 'Escape') {
                onClose();
            } else if (key === 'Space') {
                onPageNavigate(tilePage ?? focusedPage);
            } else if (!isZoomKey) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();

            if (isZoomKey) {
                // Hands zoom to the viewer's keydown handling, which owns the hotkey gate. The copy
                // starts above the grid list, which swallows character keys.
                gridRef.current?.parentElement?.dispatchEvent(
                    new KeyboardEvent('keydown', { key: event.key, shiftKey: true, bubbles: true, cancelable: true }),
                );
            }
        },
        [focusedPage, onClose, onPageNavigate],
    );

    const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
        if (CONTAINED_KEYS.has(event.key)) {
            event.preventDefault();
            event.stopPropagation();
        }
    }, []);

    const tiles = [];
    for (let i = 1; i <= pageCount; i += 1) {
        tiles.push(
            <GalleryTileV2
                key={i}
                firstPageRatio={pageRatio}
                imageSrc={highResImages[i] || loadedImages[i]}
                pageNum={i}
                pageRatio={(getPageRatio && getPageRatio(i)) || null}
                tileRef={i === currentPage ? focusInitialTile : undefined}
            />,
        );
    }

    return (
        <>
            <div
                ref={gridRef}
                className="bp-gallery-grid"
                onFocus={handleFocus}
                onKeyDown={handleKeyDown}
                onKeyDownCapture={handleKeyDownCapture}
                onScroll={handleScroll}
                role="presentation"
                tabIndex={-1}
            >
                <GridListV2
                    ref={innerRef}
                    aria-label={__('page_gallery')}
                    disallowEmptySelection
                    onAction={handleAction}
                    selectedKeys={selectedKeys}
                    selectionBehavior="replace"
                    selectionMode="single"
                    variant="small"
                >
                    {tiles}
                </GridListV2>
            </div>
            <div className="bp-gallery-close">
                <Tooltip content={__('page_gallery_close')}>
                    <IconButton
                        aria-label={__('page_gallery_close')}
                        data-resin-target="galleryClose"
                        data-target-id="GalleryGrid-close"
                        data-testid="bp-gallery-close"
                        icon={XMark}
                        onClick={onClose}
                        size="large"
                    />
                </Tooltip>
            </div>
        </>
    );
}
