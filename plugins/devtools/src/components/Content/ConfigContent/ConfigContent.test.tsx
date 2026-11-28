/*
 * Copyright 2026 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { ReactNode } from 'react';
import { act, screen } from '@testing-library/react';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import {
  AppTheme,
  AppThemeApi,
  appThemeApiRef,
} from '@backstage/core-plugin-api';
import { ConfigContent } from './ConfigContent';
import { useConfig } from '../../../hooks';

jest.mock('../../../hooks', () => ({
  useConfig: jest.fn(),
}));

const mockUseConfig = useConfig as jest.MockedFunction<typeof useConfig>;

function createMockAppThemeApi(options?: {
  activeThemeId?: string;
  themes?: Array<{ id: string; variant: 'light' | 'dark'; title: string }>;
}): AppThemeApi & { setActiveThemeId: (id?: string) => void } {
  const themes: AppTheme[] = (
    options?.themes ?? [
      { id: 'light', variant: 'light' as const, title: 'Light' },
      { id: 'dark', variant: 'dark' as const, title: 'Dark' },
    ]
  ).map(t => ({
    ...t,
    Provider: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }));

  let activeId = options?.activeThemeId;
  const listeners = new Set<(value: string | undefined) => void>();

  return {
    getInstalledThemes: () => themes,
    getActiveThemeId: () => activeId,
    activeThemeId$: () =>
      ({
        subscribe: (
          observerOrNext:
            | ((value: string | undefined) => void)
            | { next?: (value: string | undefined) => void },
        ) => {
          const next =
            typeof observerOrNext === 'function'
              ? observerOrNext
              : (value: string | undefined) => observerOrNext.next?.(value);
          listeners.add(next);
          next(activeId);
          return {
            unsubscribe: () => {
              listeners.delete(next);
            },
          };
        },
      } as unknown as ReturnType<AppThemeApi['activeThemeId$']>),
    setActiveThemeId: (id?: string) => {
      activeId = id;
      listeners.forEach(listener => listener(id));
    },
  };
}

function mockMatchMedia(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();

  const mediaQueryList = {
    get matches() {
      return matches;
    },
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: jest.fn(
      (_event: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.add(listener);
      },
    ),
    removeEventListener: jest.fn(
      (_event: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.delete(listener);
      },
    ),
    addListener: jest.fn(),
    removeListener: jest.fn(),
    dispatchEvent: jest.fn(),
  } as unknown as MediaQueryList;

  window.matchMedia = jest.fn().mockReturnValue(mediaQueryList);

  return {
    triggerChange: (nextMatches: boolean) => {
      matches = nextMatches;
      const event = { matches: nextMatches } as MediaQueryListEvent;
      listeners.forEach(listener => listener(event));
    },
  };
}

function getJsonViewerBackground(container: HTMLElement): string | undefined {
  const viewer = container.querySelector(
    '.react-json-view',
  ) as HTMLElement | null;
  return viewer?.style.backgroundColor;
}

describe('ConfigContent', () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    mockUseConfig.mockReturnValue({
      loading: false,
      configInfo: {
        config: { app: { title: 'Backstage' } },
      },
    });
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    jest.clearAllMocks();
  });

  it('renders config JSON and handles loading, error, and warning states', async () => {
    mockUseConfig.mockReturnValue({ loading: true });
    await renderInTestApp(<ConfigContent />);
    expect(await screen.findByRole('progressbar')).toBeInTheDocument();

    mockUseConfig.mockReturnValue({
      loading: false,
      error: new Error('Failed to load config'),
    });
    await renderInTestApp(<ConfigContent />);
    expect(
      await screen.findByText('Failed to load config'),
    ).toBeInTheDocument();

    mockUseConfig.mockReturnValue({ loading: false });
    await renderInTestApp(<ConfigContent />);
    expect(
      await screen.findByText('Unable to load config data'),
    ).toBeInTheDocument();

    mockUseConfig.mockReturnValue({
      loading: false,
      configInfo: {
        config: { app: { title: 'Backstage' } },
        error: {
          name: 'ConfigError',
          message: 'Validation issue',
          messages: ['Invalid field value'],
        },
      },
    });
    await renderInTestApp(<ConfigContent />);
    expect(
      await screen.findByText(/Config validation failed/),
    ).toBeInTheDocument();
    expect(screen.getByText('Invalid field value')).toBeInTheDocument();
    expect(screen.getByText(/Backstage/)).toBeInTheDocument();
  });

  it('uses dark JSON theme in Auto mode when OS prefers dark and reacts to changes', async () => {
    const media = mockMatchMedia(true);
    const appThemeApi = createMockAppThemeApi({ activeThemeId: undefined });

    const { container } = await renderInTestApp(
      <TestApiProvider apis={[[appThemeApiRef, appThemeApi]]}>
        <ConfigContent />
      </TestApiProvider>,
    );

    expect(await screen.findByText(/Backstage/)).toBeInTheDocument();
    // react-json-view "chalk" dark theme uses #151515 (rgb(21, 21, 21))
    expect(getJsonViewerBackground(container)).toBe('rgb(21, 21, 21)');

    await act(async () => {
      media.triggerChange(false);
    });
    // react-json-view "rjv-default" light theme uses transparent background
    expect(getJsonViewerBackground(container)).toBe('rgba(0, 0, 0, 0)');

    await act(async () => {
      media.triggerChange(true);
    });
    expect(getJsonViewerBackground(container)).toBe('rgb(21, 21, 21)');

    await act(async () => {
      appThemeApi.setActiveThemeId('light');
    });
    expect(getJsonViewerBackground(container)).toBe('rgba(0, 0, 0, 0)');

    await act(async () => {
      appThemeApi.setActiveThemeId(undefined);
    });
    expect(getJsonViewerBackground(container)).toBe('rgb(21, 21, 21)');
  });

  it('respects explicit theme selection and installed themes', async () => {
    mockMatchMedia(false);
    const darkSelectedApi = createMockAppThemeApi({ activeThemeId: 'dark' });

    const { container: darkContainer } = await renderInTestApp(
      <TestApiProvider apis={[[appThemeApiRef, darkSelectedApi]]}>
        <ConfigContent />
      </TestApiProvider>,
    );
    expect(await screen.findByText(/Backstage/)).toBeInTheDocument();
    expect(getJsonViewerBackground(darkContainer)).toBe('rgb(21, 21, 21)');

    mockMatchMedia(true);
    const lightOnlyApi = createMockAppThemeApi({
      activeThemeId: undefined,
      themes: [{ id: 'light', variant: 'light', title: 'Light' }],
    });

    const { container: lightOnlyContainer } = await renderInTestApp(
      <TestApiProvider apis={[[appThemeApiRef, lightOnlyApi]]}>
        <ConfigContent />
      </TestApiProvider>,
    );
    expect(getJsonViewerBackground(lightOnlyContainer)).toBe(
      'rgba(0, 0, 0, 0)',
    );
  });

  it('handles missing matchMedia gracefully', async () => {
    // @ts-expect-error simulating environment without matchMedia
    window.matchMedia = undefined;
    const appThemeApi = createMockAppThemeApi({ activeThemeId: undefined });

    const { container } = await renderInTestApp(
      <TestApiProvider apis={[[appThemeApiRef, appThemeApi]]}>
        <ConfigContent />
      </TestApiProvider>,
    );

    expect(await screen.findByText(/Backstage/)).toBeInTheDocument();
    expect(getJsonViewerBackground(container)).toBe('rgba(0, 0, 0, 0)');
  });
});
