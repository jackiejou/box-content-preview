import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BlueprintProviders from '../../../BlueprintProviders';
import { GALLERY_FALLBACK_PAGE_RATIO } from '../constants';
import GalleryGridV2, { Props } from '../GalleryGridV2';

const resizeCallbacks = new Map<Element, () => void>();
(global as unknown as { ResizeObserver: jest.Mock }).ResizeObserver = jest
    .fn()
    .mockImplementation((callback: () => void) => ({
        observe: (element: Element) => resizeCallbacks.set(element, callback),
        disconnect: jest.fn(),
        unobserve: jest.fn(),
    }));

describe('GalleryGridV2', () => {
    const getMockThumbnail = () => ({
        init: jest.fn().mockResolvedValue(100),
        getImageFromCache: jest.fn().mockReturnValue(null),
        createThumbnailImage: jest.fn().mockResolvedValue(null),
        renderPageImage: jest.fn(() => ({ cancel: jest.fn(), promise: Promise.resolve(null) })),
    });

    const getProps = (props: Partial<Props> = {}): Props => ({
        currentPage: 3,
        onClose: jest.fn(),
        onPageNavigate: jest.fn(),
        pageCount: 10,
        thumbnail: getMockThumbnail(),
        ...props,
    });

    const renderGrid = (props: Partial<Props> = {}) =>
        render(
            <BlueprintProviders>
                <GalleryGridV2 {...getProps(props)} />
            </BlueprintProviders>,
        );

    const getTile = (pageNum: number): HTMLElement => screen.getByRole('row', { name: `Page ${pageNum}` });

    const getThumbnailRatio = (pageNum: number): string | undefined =>
        getTile(pageNum)
            .querySelector<HTMLElement>('[style*="--grid-v2-thumbnail-aspect-ratio"]')
            ?.style.getPropertyValue('--grid-v2-thumbnail-aspect-ratio');

    beforeEach(() => {
        Element.prototype.scrollIntoView = jest.fn();
    });

    describe('render', () => {
        test('should render a Blueprint grid list labelled as the page gallery', () => {
            renderGrid();

            const grid = screen.getByRole('grid', { name: 'Page gallery' });
            expect(grid.closest('.bp-gallery-grid')).toBeInTheDocument();
        });

        test('should render a tile per page with the page number as visible text', () => {
            renderGrid();

            expect(screen.getAllByRole('row')).toHaveLength(10);
            expect(getTile(1)).toHaveTextContent('Page 1');
            expect(getTile(10)).toHaveTextContent('Page 10');
        });

        test('should tag every tile for resin and the Preview-owned raster loader', () => {
            renderGrid();

            screen.getAllByRole('row').forEach((tile, index) => {
                expect(tile).toHaveAttribute('data-resin-target', 'galleryTile');
                expect(tile).toHaveAttribute('data-page', String(index + 1));
            });
        });

        test('should size the thumbnail to the page ratio, falling back to a portrait page', () => {
            renderGrid({ getPageRatio: pageNum => (pageNum === 2 ? 1.5 : null) });

            expect(getThumbnailRatio(2)).toBe('1.5');
            expect(getThumbnailRatio(1)).toBe(String(GALLERY_FALLBACK_PAGE_RATIO));
        });

        test('should size the thumbnail to the loaded raster while the page ratio is unknown', async () => {
            const thumbnail = getMockThumbnail();
            thumbnail.getImageFromCache.mockImplementation((index: number) =>
                index === 2 || index === 3 ? { image: { src: `page-${index + 1}.png` }, inProgress: false } : null,
            );
            renderGrid({ getPageRatio: pageNum => (pageNum === 4 ? 0.5 : null), thumbnail });

            const loadLandscapeRaster = (pageNum: number) => {
                const img = getTile(pageNum).querySelector('img') as HTMLImageElement;
                Object.defineProperty(img, 'naturalWidth', { value: 200 });
                Object.defineProperty(img, 'naturalHeight', { value: 100 });
                fireEvent.load(img);
            };
            await waitFor(() => expect(getTile(4).querySelector('img')).toBeInTheDocument());
            loadLandscapeRaster(3);
            loadLandscapeRaster(4);

            expect(getThumbnailRatio(3)).toBe('2');
            expect(getThumbnailRatio(4)).toBe('0.5');
        });

        test('should render the loaded page raster inside the tile', async () => {
            const thumbnail = getMockThumbnail();
            thumbnail.getImageFromCache.mockImplementation((index: number) =>
                index === 2 ? { image: { src: 'page-3.png' }, inProgress: false } : null,
            );
            renderGrid({ thumbnail });

            await waitFor(() => expect(getTile(3).querySelector('img')).toHaveAttribute('src', 'page-3.png'));
            expect(getTile(1).querySelector('img')).toBeNull();
        });
    });

    describe('selection and focus', () => {
        test('should select, focus, and center the current page on mount', () => {
            renderGrid();

            expect(getTile(3)).toHaveFocus();
            expect(getTile(3)).toHaveAttribute('aria-selected', 'true');
            expect(getTile(1)).toHaveAttribute('aria-selected', 'false');
            expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
        });

        test('should move selection with focus and report the focused page', async () => {
            const onFocusChange = jest.fn();
            renderGrid({ onFocusChange });

            await userEvent.keyboard('{ArrowRight}');

            expect(getTile(4)).toHaveFocus();
            expect(getTile(4)).toHaveAttribute('aria-selected', 'true');
            expect(getTile(3)).toHaveAttribute('aria-selected', 'false');
            expect(onFocusChange).toHaveBeenLastCalledWith(4);
        });

        test.each`
            key              | expected
            ${'{ArrowLeft}'} | ${2}
            ${'{Home}'}      | ${1}
            ${'{End}'}       | ${10}
        `('should move focus to page $expected on $key', async ({ key, expected }) => {
            renderGrid();

            await userEvent.keyboard(key);

            expect(getTile(expected)).toHaveFocus();
        });

        test('should move focus one row down using the rendered layout', async () => {
            const columns = 4;
            jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getRect(
                this: HTMLElement,
            ) {
                const index = this.dataset.page ? parseInt(this.dataset.page, 10) - 1 : 0;
                const x = (index % columns) * 100;
                const y = Math.floor(index / columns) * 100;
                return { x, y, left: x, top: y, width: 100, height: 100, right: x + 100, bottom: y + 100 } as DOMRect;
            });
            renderGrid();

            await userEvent.keyboard('{ArrowDown}');

            expect(getTile(7)).toHaveFocus();
        });

        test('should redirect focus that lands on the scroll container to the selected tile', () => {
            const { container } = renderGrid();
            const scroller = container.querySelector<HTMLElement>('.bp-gallery-grid');

            act(() => scroller?.focus());

            expect(getTile(3)).toHaveFocus();
        });
    });

    describe('navigation', () => {
        test('should navigate to the clicked page', async () => {
            const onPageNavigate = jest.fn();
            renderGrid({ onPageNavigate });

            await userEvent.click(within(getTile(5)).getByText('Page 5'));

            expect(onPageNavigate).toHaveBeenCalledTimes(1);
            expect(onPageNavigate).toHaveBeenCalledWith(5);
        });

        test.each(['{Enter}', ' '])('should navigate to the focused page on %s', async key => {
            const onPageNavigate = jest.fn();
            renderGrid({ onPageNavigate });

            await userEvent.keyboard(key);

            await waitFor(() => expect(onPageNavigate).toHaveBeenCalledWith(3));
            expect(onPageNavigate).toHaveBeenCalledTimes(1);
        });
    });

    describe('closing', () => {
        test('should close on Escape', async () => {
            const onClose = jest.fn();
            renderGrid({ onClose });

            await userEvent.keyboard('{Escape}');

            expect(onClose).toHaveBeenCalledTimes(1);
        });

        test('should close from the Blueprint close button', async () => {
            const onClose = jest.fn();
            renderGrid({ onClose });

            await userEvent.click(screen.getByRole('button', { name: 'Close gallery' }));

            expect(onClose).toHaveBeenCalledTimes(1);
        });

        test('should tag the close button for analytics', () => {
            renderGrid();

            const close = screen.getByTestId('bp-gallery-close');
            expect(close).toHaveAccessibleName('Close gallery');
            expect(close).toHaveAttribute('data-resin-target', 'galleryClose');
            expect(close).toHaveAttribute('data-target-id', 'GalleryGrid-close');
        });
    });

    describe('keyboard containment', () => {
        const getDocumentKeys = (listener: jest.Mock): KeyboardEvent[] =>
            listener.mock.calls.map(([event]) => event as KeyboardEvent);

        test('should keep grid navigation keys and Escape from reaching the viewer', async () => {
            const onDocumentKeyDown = jest.fn();
            document.addEventListener('keydown', onDocumentKeyDown);
            renderGrid();

            await userEvent.keyboard('{ArrowRight}{ArrowUp}{Home}{End}{Escape}');

            document.removeEventListener('keydown', onDocumentKeyDown);
            expect(onDocumentKeyDown).not.toHaveBeenCalled();
        });

        test.each`
            shortcut               | key
            ${'{Shift>}+{/Shift}'} | ${'+'}
            ${'{Shift>}_{/Shift}'} | ${'_'}
        `('should hand the zoom shortcut $key to the viewer keydown handling', async ({ shortcut, key }) => {
            const onDocumentKeyDown = jest.fn();
            const onScaleChange = jest.fn();
            document.addEventListener('keydown', onDocumentKeyDown);
            renderGrid({ onScaleChange, scale: 1.5 });

            await userEvent.keyboard(shortcut);

            document.removeEventListener('keydown', onDocumentKeyDown);
            const zoomEvents = getDocumentKeys(onDocumentKeyDown).filter(event => event.key === key);
            expect(zoomEvents).toHaveLength(1);
            expect(zoomEvents[0]).toMatchObject({ defaultPrevented: false, shiftKey: true });
            expect(onScaleChange).not.toHaveBeenCalled();
        });

        test.each(['Control', 'Meta'])(
            'should keep the viewer find shortcut from reaching the viewer with %s held on a tile',
            async modifier => {
                const onDocumentKeyDown = jest.fn();
                document.addEventListener('keydown', onDocumentKeyDown);
                renderGrid();
                expect(getTile(3)).toHaveFocus();

                await userEvent.keyboard(`{${modifier}>}f{/${modifier}}`);

                document.removeEventListener('keydown', onDocumentKeyDown);
                expect(getDocumentKeys(onDocumentKeyDown).map(event => event.key)).not.toContain('f');
            },
        );
    });

    describe('zoom layout', () => {
        beforeEach(() => {
            document.documentElement.style.fontSize = '16px';
        });

        afterEach(() => {
            document.documentElement.style.fontSize = '';
        });

        test.each`
            gap      | rootFontSize | expected
            ${'8px'} | ${'16px'}    | ${'656px'}
            ${'0px'} | ${'16px'}    | ${'500px'}
            ${'8px'} | ${'24px'}    | ${'992px'}
        `(
            'should size the columns from the rendered $gap gap and $rootFontSize root font size',
            ({ gap, rootFontSize, expected }) => {
                const { rerender } = renderGrid({ scale: 1 });
                const grid = screen.getByRole('grid');
                jest.spyOn(grid, 'clientWidth', 'get').mockReturnValue(1000);
                grid.style.columnGap = gap;
                document.documentElement.style.fontSize = rootFontSize;

                const renderWithScale = (scale: number) =>
                    rerender(
                        <BlueprintProviders>
                            <GalleryGridV2 {...getProps({ scale })} />
                        </BlueprintProviders>,
                    );

                renderWithScale(2);
                expect(grid.style.gridTemplateColumns).toBe(`repeat(auto-fill, ${expected})`);
                expect(grid.style.justifyContent).toBe('center');

                renderWithScale(1);
                expect(grid.style.gridTemplateColumns).toBe('');
                expect(grid.style.justifyContent).toBe('');
            },
        );

        test('should re-run the Preview-owned layout when the container resizes', () => {
            const { container } = renderGrid({ scale: 2 });
            const grid = screen.getByRole('grid');
            const scroller = container.querySelector('.bp-gallery-grid') as Element;
            jest.spyOn(grid, 'clientWidth', 'get').mockReturnValue(500);
            grid.style.columnGap = '8px';

            act(() => resizeCallbacks.get(scroller)?.());

            expect(grid.style.gridTemplateColumns).toBe('repeat(auto-fill, 500px)');
        });
    });
});
