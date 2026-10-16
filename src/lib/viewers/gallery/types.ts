import { HighResRenderTask } from './HighResThumbnailStore';
import { PinchDirection } from './useGalleryPinch';

export interface GalleryThumbnail {
    init: () => Promise<unknown>;
    getImageFromCache: (itemIndex: number) => { image?: HTMLImageElement; inProgress: boolean } | null | undefined;
    createThumbnailImage: (
        itemIndex: number,
        options: { createImgTag: boolean; thumbMaxWidth: number },
    ) => Promise<HTMLImageElement | null>;
    renderPageImage: (pageNum: number, options: { thumbMaxWidth: number }) => HighResRenderTask;
    /** First-page width:height ratio, populated by init(). Used to size placeholders to the real page shape. */
    pageRatio?: number;
}

export type GalleryGridBaseProps = {
    pageCount: number;
    currentPage: number;
    /** Per-page width:height ratio (null while unknown). Falls back to the first-page ratio. */
    getPageRatio?: (pageNum: number) => number | null;
    isPinchZoomEnabled?: boolean;
    isTouchZoomEnabled?: boolean;
    onFocusChange?: (pageNum: number) => void;
    onPageNavigate: (n: number) => void;
    onClose: () => void;
    onPinchStart?: (direction: PinchDirection) => void;
    onScaleChange?: (scale: number) => boolean | void;
    scale?: number;
    thumbnail: GalleryThumbnail;
};

export type GalleryTileLayout = {
    /** Column gap of the grid at 100% zoom, in CSS pixels. */
    gapPx: number;
    /** Minimum column width of the grid at 100% zoom, in CSS pixels. */
    minWidthPx: number;
};
