import React from 'react';
import BaseViewer from '../BaseViewer';
import Browser from '../../Browser';
import ControlsRoot from '../controls';
import TextControls from './TextControls';
import { CLASS_IS_PRINTABLE, CLASS_IS_SELECTABLE, PERMISSION_DOWNLOAD } from '../../constants';
import { checkPermission } from '../../file';

const ZOOM_DEFAULT = 1.0;
const ZOOM_MAX = 10;
const ZOOM_MIN = 0.1;
const ZOOM_STEP = 0.1;
const MIN_PINCH_SCALE_DELTA = 0.01;

class TextBaseViewer extends BaseViewer {
    /**
     * @inheritdoc
     */
    constructor(options) {
        super(options);

        this.api = options.api;
        this.scale = ZOOM_DEFAULT;

        // Bind context for handlers;
        this.zoomOut = this.zoomOut.bind(this);
        this.zoomIn = this.zoomIn.bind(this);
        this.wheelZoomHandler = this.wheelZoomHandler.bind(this); // Trackpad pinch-to-zoom support
    }

    /**
     * @inheritdoc
     */
    setup() {
        if (this.isSetup) {
            return;
        }

        // Call super() to set up common layout
        super.setup();
    }

    /**
     * [destructor]
     * @return {void}
     */
    destroy() {
        this.unbindDOMListeners();

        // Destroy the controls
        if (this.controls && typeof this.controls.destroy === 'function') {
            this.controls.destroy();
        }

        super.destroy();
    }

    /**
     * Zooms by increasing or decreasing font size
     * @public
     * @param {string} type - in, out, reset
     * @return {void}
     */
    zoom(type) {
        let newScale = ZOOM_DEFAULT;

        if (type === 'in') {
            newScale = this.scale + ZOOM_STEP;
            newScale = newScale <= ZOOM_MAX ? newScale : ZOOM_MAX;
        } else if (type === 'out') {
            newScale = this.scale - ZOOM_STEP;
            newScale = newScale >= ZOOM_MIN ? newScale : ZOOM_MIN;
        }

        // Convert the decimal scale to a percentage font size for text content
        this.containerEl.querySelector('.bp-text').style.fontSize = `${Math.round(newScale * 100)}%`;

        this.emit('zoom', {
            canZoomIn: true,
            canZoomOut: true,
            zoom: newScale,
        });

        this.scale = newScale;
        this.renderUI();
    }

    /**
     * Zooms in.
     *
     * @return {void}
     * @public
     */
    zoomIn() {
        this.zoom('in');
    }

    /**
     * Zooms out.
     *
     * @return {void}
     * @public
     */
    zoomOut() {
        this.zoom('out');
    }

    /**
     * Loads content.
     *
     * @override
     * @return {void}
     */
    load() {
        // Enable text selection if user has download permissions and 'disableTextLayer' option is not true
        if (checkPermission(this.options.file, PERMISSION_DOWNLOAD) && !this.getViewerOption('disableTextLayer')) {
            this.containerEl.classList.add(CLASS_IS_PRINTABLE);
            this.containerEl.classList.add(CLASS_IS_SELECTABLE);
        }

        this.bindDOMListeners();
        super.load();
    }

    /**
     * Binds DOM listeners for text viewer pinch-to-zoom.
     *
     * @protected
     * @return {void}
     */
    bindDOMListeners() {
        this.containerEl.addEventListener('wheel', this.wheelZoomHandler, { passive: false }); // Trackpad pinch-to-zoom

        if (this.hasTouch) {
            if (Browser.isIOS()) {
                this.containerEl.addEventListener('gesturestart', this.mobileZoomStartHandler);
                this.containerEl.addEventListener('gestureend', this.mobileZoomEndHandler);
            } else {
                this.containerEl.addEventListener('touchstart', this.mobileZoomStartHandler);
                this.containerEl.addEventListener('touchmove', this.mobileZoomChangeHandler);
                this.containerEl.addEventListener('touchend', this.mobileZoomEndHandler);
            }
        }
    }

    /**
     * Unbinds DOM listeners for text viewer pinch-to-zoom.
     *
     * @protected
     * @return {void}
     */
    unbindDOMListeners() {
        if (this.containerEl) {
            this.containerEl.removeEventListener('wheel', this.wheelZoomHandler);
            this.containerEl.removeEventListener('gesturestart', this.mobileZoomStartHandler);
            this.containerEl.removeEventListener('gestureend', this.mobileZoomEndHandler);
            this.containerEl.removeEventListener('touchstart', this.mobileZoomStartHandler);
            this.containerEl.removeEventListener('touchmove', this.mobileZoomChangeHandler);
            this.containerEl.removeEventListener('touchend', this.mobileZoomEndHandler);
        }
    }

    /**
     * Handles trackpad pinch-to-zoom via wheel events with ctrlKey.
     * On Mac trackpads, pinch gestures fire wheel events with ctrlKey set to true.
     *
     * @protected
     * @param {WheelEvent} event - wheel event object
     * @return {void}
     */
    wheelZoomHandler(event) {
        if (!event.ctrlKey) {
            return;
        }

        event.preventDefault();

        const textEl = this.containerEl.querySelector('.bp-text');
        if (!textEl) {
            return;
        }

        const prevScale = this.scale;
        const delta = -event.deltaY * MIN_PINCH_SCALE_DELTA;
        const newScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prevScale * (1 + delta)));

        if (newScale === prevScale) {
            return;
        }

        // Anchor the zoom at the cursor. With unitless line-height, text scales by exactly
        // the font-size ratio - but padding does NOT scale, so we work in text-local coords
        // (cursor position relative to the text origin, past any padding).
        const rect = textEl.getBoundingClientRect();
        const style = window.getComputedStyle(textEl);
        const paddingTop = parseFloat(style.paddingTop) || 0;
        const paddingLeft = parseFloat(style.paddingLeft) || 0;

        const cursorX = event.clientX - rect.left;
        const cursorY = event.clientY - rect.top;
        const textCursorX = textEl.scrollLeft + cursorX - paddingLeft;
        const textCursorY = textEl.scrollTop + cursorY - paddingTop;

        // Apply scale. Use fractional percent so tiny pinch deltas produce continuous size
        // changes instead of 1% steps (the zoom() button path still rounds). Round-trip
        // through toFixed so our ratio math matches what the browser actually applies.
        const appliedScale = Number.parseFloat((newScale * 100).toFixed(2)) / 100;
        if (appliedScale === prevScale) {
            return;
        }
        textEl.style.fontSize = `${appliedScale * 100}%`;

        const ratio = appliedScale / prevScale;
        textEl.scrollLeft = textCursorX * ratio + paddingLeft - cursorX;
        textEl.scrollTop = textCursorY * ratio + paddingTop - cursorY;

        this.emit('zoom', {
            canZoomIn: appliedScale < ZOOM_MAX,
            canZoomOut: appliedScale > ZOOM_MIN,
            zoom: appliedScale,
        });

        this.scale = appliedScale;
        this.renderUI();
    }

    /**
     * Load controls
     *
     * @return {void}
     * @protected
     */
    loadUI() {
        this.controls = new ControlsRoot({ containerEl: this.containerEl, fileId: this.options.file.id });
        this.renderUI();
    }

    /**
     * Render controls
     *
     * @return {void}
     * @protected
     */
    renderUI() {
        if (!this.controls) {
            return;
        }

        this.controls.render(
            <TextControls
                maxScale={ZOOM_MAX}
                minScale={ZOOM_MIN}
                onFullscreenToggle={this.toggleFullscreen}
                onZoomIn={this.zoomIn}
                onZoomOut={this.zoomOut}
                scale={this.scale}
            />,
        );
    }

    /**
     * Handles keyboard events for media
     *
     * @param {string} key - keydown key
     * @return {boolean} consumed or not
     * @protected
     */
    onKeydown(key) {
        // Return false when media controls are not ready or are focused
        if (!this.controls) {
            return false;
        }

        if (key === 'Shift++') {
            this.zoomIn();
            return true;
        }
        if (key === 'Shift+_') {
            this.zoomOut();
            return true;
        }

        return false;
    }

    /**
     * @inheritdoc
     */
    resize() {
        super.resize();
    }
}

export default TextBaseViewer;
