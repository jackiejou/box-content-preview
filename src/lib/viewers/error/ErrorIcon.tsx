import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import FileDefault from '@box/blueprint-web-assets/icons/Content/FileDefault';
import { getIcon } from 'box-ui-elements/es/components/preview';

export type Options = {
    containerEl: HTMLElement;
    isBlueprintEnabled?: boolean;
};

export default class ErrorIcon {
    isBlueprintEnabled: boolean;

    root: Root;

    constructor({ containerEl, isBlueprintEnabled = false }: Options) {
        this.isBlueprintEnabled = isBlueprintEnabled;
        this.root = createRoot(containerEl);
    }

    destroy(): void {
        this.root.unmount();
    }

    render(extension?: string): void {
        if (this.isBlueprintEnabled) {
            // TODO(jackiejou): render the per-extension icon from @box/item-icon once it is installed as a peer dependency
            this.root.render(<FileDefault aria-hidden="true" focusable="false" />);
            return;
        }

        const Icon = getIcon(extension);

        this.root.render(<Icon extension={extension} />);
    }
}
