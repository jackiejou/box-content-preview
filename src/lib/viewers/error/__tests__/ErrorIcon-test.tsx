import React from 'react';
import { act, render } from '@testing-library/react';
import FileDefault from '@box/blueprint-web-assets/icons/Content/FileDefault';
import { getIcon } from 'box-ui-elements/es/components/preview';
import ErrorIcon from '../ErrorIcon';

describe('lib/viewers/error/ErrorIcon', () => {
    let containerEl: HTMLElement;
    let errorIcon: ErrorIcon;

    const renderIcon = (extension: string, isBlueprintEnabled: boolean): void => {
        errorIcon = new ErrorIcon({ containerEl, isBlueprintEnabled });
        act(() => errorIcon.render(extension));
    };

    beforeEach(() => {
        containerEl = document.createElement('div');
        document.body.appendChild(containerEl);
    });

    afterEach(() => {
        act(() => errorIcon.destroy());
        containerEl.remove();
    });

    describe('render()', () => {
        test.each(['pdf', 'zip', 'unknown'])(
            'should render the box-ui-elements icon for %s when isBlueprintEnabled is false',
            extension => {
                const LegacyIcon = getIcon(extension);
                const { container: expected } = render(<LegacyIcon extension={extension} />);

                renderIcon(extension, false);

                expect(containerEl.innerHTML).toBe(expected.innerHTML);
            },
        );

        test('should default to the legacy icon when the isBlueprintEnabled option is omitted', () => {
            const LegacyIcon = getIcon('pdf');
            const { container: expected } = render(<LegacyIcon extension="pdf" />);

            errorIcon = new ErrorIcon({ containerEl });
            act(() => errorIcon.render('pdf'));

            expect(containerEl.innerHTML).toBe(expected.innerHTML);
        });

        test.each(['pdf', 'zip', 'unknown'])(
            'should render the generic Blueprint file icon for %s when isBlueprintEnabled is true',
            extension => {
                const { container: expected } = render(<FileDefault aria-hidden="true" focusable="false" />);

                renderIcon(extension, true);

                expect(containerEl.innerHTML).toBe(expected.innerHTML);
            },
        );

        test('should hide the Blueprint icon from assistive technology', () => {
            renderIcon('pdf', true);

            const icon = containerEl.querySelector('svg');
            expect(icon).toHaveAttribute('aria-hidden', 'true');
            expect(icon).toHaveAttribute('focusable', 'false');
        });
    });

    describe('destroy()', () => {
        test('should unmount the rendered icon', () => {
            renderIcon('pdf', true);

            act(() => errorIcon.destroy());

            expect(containerEl).toBeEmptyDOMElement();
        });
    });
});
