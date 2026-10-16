import React from 'react';
import { createPortal } from 'react-dom';
import { createRoot, Root } from 'react-dom/client';
import { Ghost, Text } from '@box/blueprint-web';
import BlueprintProviders from './BlueprintProviders';
import ThumbnailsSidebar, { CLASS_BOX_PREVIEW_THUMBNAIL_IMAGE_LOADED } from './ThumbnailsSidebar';
import { replacePlaceholders } from './util';
import './ThumbnailsSidebarV2.scss';

const CLASS_SIDEBAR = 'bp-ThumbnailsSidebarV2';
const CLASS_ITEM = 'bp-ThumbnailsSidebarV2-item';
const CLASS_ITEM_SELECTED = 'bp-ThumbnailsSidebarV2-item--selected';
const CLASS_CHROME = 'bp-ThumbnailsSidebarV2-chrome';
const CLASS_PAGE = 'bp-ThumbnailsSidebarV2-page';

type Props = {
    pageNumber: number;
};

type Row = HTMLElement | null | undefined;

const ThumbnailChrome = React.memo(function ThumbnailChrome({ pageNumber }: Props): JSX.Element {
    return (
        <>
            <span className="bp-ThumbnailsSidebarV2-ghost">
                <Ghost
                    borderRadius="var(--bp-radius-03)"
                    data-testid="bp-ThumbnailsSidebarV2-ghost"
                    height="100%"
                    variant="rectangle"
                    width="100%"
                />
            </span>
            <span className="bp-ThumbnailsSidebarV2-pageNumber">
                <Text as="span" color="textOnDarkDefault" variant="bodyDefault">
                    {`${pageNumber}`}
                </Text>
            </span>
        </>
    );
});

function setSelected(thumbnailEl: HTMLElement, isSelected: boolean): void {
    thumbnailEl.classList.toggle(CLASS_ITEM_SELECTED, isSelected);

    if (isSelected) {
        thumbnailEl.setAttribute('aria-current', 'true');
    } else {
        thumbnailEl.removeAttribute('aria-current');
    }
}

function getPageNumber(thumbnailEl: HTMLElement): number {
    return parseInt(thumbnailEl.dataset.bpPageNum || '', 10);
}

// Item chrome renders through portals from one root, at most once per microtask. VirtualScroller
// owns row creation and removal, and React renders only the rows still in the document.
export default class ThumbnailsSidebarV2 extends ThumbnailsSidebar {
    private readonly chromeRoot: Root = createRoot(document.createElement('div'));

    private isChromeRenderPending = false;

    private isDestroyed = false;

    constructor(element: HTMLElement, pdfViewer: unknown, preloader?: unknown) {
        super(element, pdfViewer, preloader);
        element.classList.add(CLASS_SIDEBAR);
    }

    destroy(): void {
        this.isDestroyed = true;
        this.chromeRoot.unmount();
        this.anchorEl.classList.remove(CLASS_SIDEBAR);
        super.destroy();
    }

    applyCurrentPageSelection(): void {
        this.currentThumbnails.forEach((thumbnailEl: Row) => {
            if (thumbnailEl) {
                setSelected(thumbnailEl, getPageNumber(thumbnailEl) === this.currentPage);
            }
        });
    }

    createPlaceholderThumbnail(itemIndex: number): HTMLElement {
        const pageNumber = itemIndex + 1;
        const thumbnailEl = document.createElement('div');
        thumbnailEl.className = CLASS_ITEM;
        thumbnailEl.dataset.bpPageNum = `${pageNumber}`;
        thumbnailEl.setAttribute('role', 'button');
        thumbnailEl.setAttribute('aria-label', replacePlaceholders(__('page_gallery_tile'), [`${pageNumber}`]));

        const chromeEl = document.createElement('span');
        chromeEl.className = CLASS_CHROME;
        chromeEl.setAttribute('aria-hidden', 'true');
        thumbnailEl.appendChild(chromeEl);

        // ThumbnailsSidebar appends the rendered page image to the item's last child.
        const pageEl = document.createElement('div');
        pageEl.className = CLASS_PAGE;
        thumbnailEl.appendChild(pageEl);

        setSelected(thumbnailEl, pageNumber === this.currentPage);

        const cachedImage = this.thumbnail.getImageFromCache(itemIndex);
        if (cachedImage?.image && !cachedImage.inProgress) {
            pageEl.appendChild(cachedImage.image);
            thumbnailEl.classList.add(CLASS_BOX_PREVIEW_THUMBNAIL_IMAGE_LOADED);
        }

        this.currentThumbnails.push(thumbnailEl);
        this.renderChrome();

        return thumbnailEl;
    }

    generateThumbnailImages(listInfo: { items: Row[] }): void {
        super.generateThumbnailImages(listInfo);
        this.renderChrome();
    }

    refresh(): Promise<void> {
        const result = super.refresh();
        this.renderChrome();
        return result;
    }

    thumbnailClickHandler(event: MouseEvent): void {
        const thumbnailEl = (event.target as Element).closest<HTMLElement>(`.${CLASS_ITEM}`);

        if (!thumbnailEl) {
            return;
        }

        if (this.onThumbnailSelect) {
            this.onThumbnailSelect(getPageNumber(thumbnailEl));
        }

        this.anchorEl.focus();

        event.preventDefault();
        event.stopImmediatePropagation();
    }

    renderChrome(): void {
        if (this.isDestroyed || this.isChromeRenderPending) {
            return;
        }

        this.isChromeRenderPending = true;
        queueMicrotask(() => {
            this.isChromeRenderPending = false;
            this.flushChrome();
        });
    }

    private flushChrome(): void {
        if (this.isDestroyed) {
            return;
        }

        const portals = this.currentThumbnails.map((thumbnailEl: Row) => {
            const hostEl = thumbnailEl?.isConnected && thumbnailEl.querySelector(`.${CLASS_CHROME}`);

            if (!thumbnailEl || !hostEl) {
                return null;
            }

            const pageNumber = getPageNumber(thumbnailEl);
            return createPortal(<ThumbnailChrome pageNumber={pageNumber} />, hostEl, `${pageNumber}`);
        });

        this.chromeRoot.render(<BlueprintProviders container={this.anchorEl}>{portals}</BlueprintProviders>);
    }
}
