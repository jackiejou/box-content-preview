import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import noop from 'lodash/noop';
import { decodeKeydown, replacePlaceholders } from '../../util';
import { GALLERY_TILE_GAP, GALLERY_TILE_MIN_WIDTH } from './constants';
import { getColumnIndex, getPageAbove, getPageBelow, getRowCount } from './galleryGridNavigation';
import useGalleryGrid from './useGalleryGrid';
import { GalleryGridBaseProps, GalleryTileLayout } from './types';
import './GalleryGrid.scss';

export type Props = GalleryGridBaseProps & {
    /** When true, use ARIA grid roles and 2D arrow navigation instead of listbox/option. */
    isAriaGridEnabled?: boolean;
};

const TILE_LAYOUT: GalleryTileLayout = { gapPx: GALLERY_TILE_GAP, minWidthPx: GALLERY_TILE_MIN_WIDTH };

interface TileProps {
    pageNum: number;
    isFocused: boolean;
    ariaColIndex?: number;
    imageSrc?: string;
    onClick: (pageNum: number) => void;
    onFocus: (pageNum: number) => void;
    pageRatio?: number | null;
    role: 'option' | 'gridcell';
}

const GalleryTile = React.memo(function GalleryTile({
    pageNum,
    isFocused,
    ariaColIndex,
    imageSrc,
    onClick,
    onFocus,
    pageRatio,
    role,
}: TileProps): JSX.Element {
    const ratio = pageRatio && Number.isFinite(pageRatio) && pageRatio > 0 ? pageRatio : null;
    const tileStyle = ratio ? { aspectRatio: String(ratio) } : undefined;
    const contentStyle = ratio ? { height: '100%' } : undefined;
    const placeholderStyle = ratio ? { ...contentStyle, paddingTop: 0 } : undefined;

    return (
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events
        <div
            aria-colindex={ariaColIndex}
            aria-label={replacePlaceholders(__('page_gallery_tile'), [String(pageNum)])}
            aria-selected={isFocused}
            className={`bp-gallery-tile${isFocused ? ' bp-gallery-tile--selected' : ''}`}
            data-page={pageNum}
            data-resin-target="galleryTile"
            onClick={() => onClick(pageNum)}
            onFocus={() => onFocus(pageNum)}
            role={role}
            style={tileStyle}
            tabIndex={isFocused ? 0 : -1}
        >
            <span aria-hidden="true" className="bp-gallery-tile-badge">
                {pageNum}
            </span>
            {imageSrc ? (
                <img alt="" src={imageSrc} style={contentStyle} />
            ) : (
                <span className="bp-gallery-tile-placeholder" style={placeholderStyle} />
            )}
        </div>
    );
});

export default function GalleryGrid({
    pageCount,
    currentPage,
    getPageRatio,
    isAriaGridEnabled = false,
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
    // Measured from the rendered layout; drives ARIA grid row/column numbers and 2D navigation.
    const [columnCount, setColumnCount] = useState(1);
    const anchorPageRef = useRef(currentPage);
    const gridRef = useRef<HTMLDivElement>(null);
    const innerRef = useRef<HTMLDivElement>(null);
    const columnCountRef = useRef(1);
    const restoreFocusRef = useRef(false);
    // Anchor tile and its viewport top, captured together when a re-chunk is scheduled so the
    // post-commit effect restores against the same tile even if the anchor page changes meanwhile.
    const rechunkAnchorRef = useRef<{ page: number; top: number } | null>(null);

    // Counts tiles sharing the first row's offsetTop, so the column count follows whatever
    // track sizing the stylesheet or zoom applied.
    const measureColumnCount = useCallback(() => {
        const grid = gridRef.current;
        const inner = innerRef.current;
        if (!isAriaGridEnabled || !grid || !inner) {
            return;
        }

        // Without a layout box (hidden host, zero-size container), offsetTop reads 0 for every
        // tile and the count would balloon to the page count; keep the last measured value.
        if (!inner.offsetWidth) {
            return;
        }

        const tiles = inner.querySelectorAll<HTMLElement>('[data-page]');
        if (tiles.length === 0) {
            return;
        }

        let count = 1;
        while (count < tiles.length && tiles[count].offsetTop === tiles[0].offsetTop) {
            count += 1;
        }

        if (count !== columnCountRef.current) {
            // Re-chunking tiles into different rows recreates the focused tile's DOM node,
            // which would silently drop focus to <body>; remember to restore it post-render.
            restoreFocusRef.current = grid.contains(document.activeElement);
            // Capture where the anchor tile sits now, after any zoom/resize scroll fixups that
            // already ran, so the post-commit effect can restore its position.
            const anchorPage = anchorPageRef.current;
            const anchorTile = grid.querySelector(`[data-page="${anchorPage}"]`);
            rechunkAnchorRef.current = anchorTile
                ? { page: anchorPage, top: anchorTile.getBoundingClientRect().top }
                : null;
            columnCountRef.current = count;
            setColumnCount(count);
        }
    }, [isAriaGridEnabled]);

    const { handleScroll, highResImages, loadedImages, pageRatio } = useGalleryGrid({
        anchorPageRef,
        currentPage,
        gridRef,
        innerRef,
        isPinchZoomEnabled,
        isTouchZoomEnabled,
        onInitialTileFocus: tile => {
            // The mount layout pass may capture this tile before the hook centers it; refresh the
            // capture so the re-chunk restore keeps the centering.
            const anchor = rechunkAnchorRef.current;
            if (anchor && anchor.page === currentPage) {
                anchor.top = tile.getBoundingClientRect().top;
            }
        },
        onLayoutChange: measureColumnCount,
        onPinchStart,
        onScaleChange,
        pageCount,
        scale,
        thumbnail,
        tileLayout: TILE_LAYOUT,
    });

    const focusTile = useCallback((pageNum: number, options?: FocusOptions) => {
        const grid = gridRef.current;
        if (!grid) return;
        const tile = grid.querySelector(`[data-page="${pageNum}"]`) as HTMLElement | null;
        if (tile) {
            tile.focus(options);
        }
    }, []);

    // Re-chunk recreates the tile DOM nodes, which drops focus and can shift the scroll
    // position; restore both after the new nodes commit.
    const committedColumnCountRef = useRef(columnCount);
    useLayoutEffect(() => {
        const isRechunk = committedColumnCountRef.current !== columnCount;
        committedColumnCountRef.current = columnCount;
        if (!isRechunk) {
            return;
        }

        const active = document.activeElement;
        if (restoreFocusRef.current || !active || active === document.body) {
            restoreFocusRef.current = false;
            focusTile(focusedPage, { preventScroll: true });
        }

        const anchor = rechunkAnchorRef.current;
        rechunkAnchorRef.current = null;

        // Swapping the row DOM out from under the scroller can shift scrollTop. Restore the
        // captured anchor tile to its captured viewport position by delta, preserving the mount
        // centering and the zoom focal-point / resize fixups that already ran.
        const grid = gridRef.current;
        if (grid && anchor) {
            const tile = grid.querySelector(`[data-page="${anchor.page}"]`) as HTMLElement | null;
            if (tile) {
                grid.scrollTop += tile.getBoundingClientRect().top - anchor.top;
            }
        }
    }, [columnCount, focusedPage, focusTile]);

    const handleTileFocus = useCallback(
        (pageNum: number) => {
            setFocusedPage(pageNum);
            if (onFocusChange) {
                onFocusChange(pageNum);
            }
        },
        [onFocusChange],
    );

    const handleTileClick = useCallback(
        (pageNum: number) => {
            onPageNavigate(pageNum);
        },
        [onPageNavigate],
    );

    const handleGridFocus = useCallback(
        (event: React.FocusEvent) => {
            if (event.target === gridRef.current) {
                focusTile(focusedPage, { preventScroll: true });
            }
        },
        [focusedPage, focusTile],
    );

    const handleGridKeyDown = useCallback(
        (event: React.KeyboardEvent) => {
            const key = decodeKeydown(event);

            switch (key) {
                case 'Escape':
                    event.preventDefault();
                    event.stopPropagation();
                    onClose();
                    return;
                // Listbox: every arrow moves ±1 page. ARIA grid: Left/Right stay ±1 (across row
                // edges, clamped at first/last page); Up/Down move one row (Down clamps on a short last row).
                case 'ArrowUp': {
                    event.preventDefault();
                    event.stopPropagation();
                    const target = isAriaGridEnabled ? getPageAbove(focusedPage, columnCount) : focusedPage - 1;
                    if (target !== null && target >= 1) {
                        focusTile(target);
                    }
                    return;
                }
                case 'ArrowDown': {
                    event.preventDefault();
                    event.stopPropagation();
                    const target = isAriaGridEnabled
                        ? getPageBelow(focusedPage, columnCount, pageCount)
                        : focusedPage + 1;
                    if (target !== null && target <= pageCount) {
                        focusTile(target);
                    }
                    return;
                }
                case 'ArrowLeft':
                    event.preventDefault();
                    event.stopPropagation();
                    if (focusedPage > 1) {
                        focusTile(focusedPage - 1);
                    }
                    return;
                case 'ArrowRight':
                    event.preventDefault();
                    event.stopPropagation();
                    if (focusedPage < pageCount) {
                        focusTile(focusedPage + 1);
                    }
                    return;
                case 'Home':
                    event.preventDefault();
                    event.stopPropagation();
                    focusTile(1);
                    return;
                case 'End':
                    event.preventDefault();
                    event.stopPropagation();
                    focusTile(pageCount);
                    return;
                case 'Enter':
                case 'Space':
                    event.preventDefault();
                    event.stopPropagation();
                    onPageNavigate(focusedPage);
                    break;
                default:
            }
        },
        [columnCount, focusedPage, focusTile, isAriaGridEnabled, onClose, onPageNavigate, pageCount],
    );

    const tiles = [];
    for (let i = 1; i <= pageCount; i += 1) {
        tiles.push(
            <GalleryTile
                key={i}
                ariaColIndex={isAriaGridEnabled ? getColumnIndex(i, columnCount) : undefined}
                imageSrc={highResImages[i] || loadedImages[i]}
                isFocused={i === focusedPage}
                onClick={handleTileClick}
                onFocus={handleTileFocus}
                pageNum={i}
                pageRatio={(getPageRatio && getPageRatio(i)) || pageRatio}
                role={isAriaGridEnabled ? 'gridcell' : 'option'}
            />,
        );
    }

    // ARIA requires gridcells to live inside rows. The display: contents row wrappers add
    // that level to the accessibility tree without generating boxes, so the tiles remain
    // direct CSS-grid items and the visual layout is identical to the flat listbox.
    let content: React.ReactNode = tiles;
    if (isAriaGridEnabled) {
        const rows = [];
        for (let start = 0; start < tiles.length; start += columnCount) {
            const rowIndex = start / columnCount + 1;
            rows.push(
                // Named with the row number so AT announces that instead of every tile in the row.
                <div
                    key={start}
                    aria-label={String(rowIndex)}
                    aria-rowindex={rowIndex}
                    className="bp-gallery-grid-row"
                    role="row"
                >
                    {tiles.slice(start, start + columnCount)}
                </div>,
            );
        }
        content = rows;
    }

    return (
        <div
            ref={gridRef}
            aria-colcount={isAriaGridEnabled ? columnCount : undefined}
            aria-label={__('page_gallery')}
            aria-rowcount={isAriaGridEnabled ? getRowCount(pageCount, columnCount) : undefined}
            className="bp-gallery-grid"
            onFocus={handleGridFocus}
            onKeyDown={handleGridKeyDown}
            onScroll={handleScroll}
            role={isAriaGridEnabled ? 'grid' : 'listbox'}
            tabIndex={-1}
        >
            <div ref={innerRef} className="bp-gallery-grid-inner" role="presentation">
                {content}
            </div>
        </div>
    );
}
