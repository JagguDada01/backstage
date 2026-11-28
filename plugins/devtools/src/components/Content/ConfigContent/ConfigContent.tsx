/*
 * Copyright 2022 The Backstage Authors
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

import { useEffect, useMemo, useState } from 'react';
import { Progress, WarningPanel } from '@backstage/core-components';
import { AppTheme, appThemeApiRef, useApi } from '@backstage/core-plugin-api';
import { Alert, Box, Text } from '@backstage/ui';
import useObservable from 'react-use/esm/useObservable';
import ReactJson from 'react-json-view';
import { useConfig } from '../../../hooks';
import { ConfigError } from '@backstage/plugin-devtools-common';

function usePrefersDarkTheme(): boolean {
  const mediaQuery = useMemo(
    () =>
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : undefined,
    [],
  );
  const [prefersDark, setPrefersDark] = useState(mediaQuery?.matches ?? false);

  useEffect(() => {
    if (!mediaQuery) {
      return undefined;
    }
    setPrefersDark(mediaQuery.matches);
    const listener = (event: MediaQueryListEvent) => {
      setPrefersDark(event.matches);
    };
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', listener);
      return () => mediaQuery.removeEventListener('change', listener);
    }
    mediaQuery.addListener?.(listener);
    return () => mediaQuery.removeListener?.(listener);
  }, [mediaQuery]);

  return prefersDark;
}

function resolveActiveTheme(
  themeId: string | undefined,
  prefersDark: boolean,
  themes: AppTheme[],
): AppTheme | undefined {
  if (themeId !== undefined) {
    const selectedTheme = themes.find(theme => theme.id === themeId);
    if (selectedTheme) {
      return selectedTheme;
    }
  }

  if (prefersDark) {
    const darkTheme = themes.find(theme => theme.variant === 'dark');
    if (darkTheme) {
      return darkTheme;
    }
  }

  const lightTheme = themes.find(theme => theme.variant === 'light');
  if (lightTheme) {
    return lightTheme;
  }

  return themes[0];
}

export const WarningContent = ({ error }: { error: ConfigError }) => {
  if (!error.messages) {
    return <Text as="p">{error.message}</Text>;
  }

  const messages = error.messages;

  return (
    <Box>
      {messages.map(message => (
        <Text as="p" key={message}>
          {message}
        </Text>
      ))}
    </Box>
  );
};

/** @public */
export const ConfigContent = () => {
  const appThemeApi = useApi(appThemeApiRef);
  const activeThemeId = useObservable(
    appThemeApi.activeThemeId$(),
    appThemeApi.getActiveThemeId(),
  );
  const prefersDark = usePrefersDarkTheme();
  const activeTheme = resolveActiveTheme(
    activeThemeId,
    prefersDark,
    appThemeApi.getInstalledThemes(),
  );
  const isDark = activeTheme ? activeTheme.variant === 'dark' : prefersDark;
  const { configInfo, loading, error } = useConfig();

  if (loading) {
    return <Progress />;
  } else if (error) {
    return <Alert status="danger" description={error.message} />;
  }

  if (!configInfo) {
    return <Alert status="danger" description="Unable to load config data" />;
  }

  return (
    <Box>
      {configInfo && configInfo.error && (
        <Box pb="2">
          <WarningPanel title="Config validation failed">
            <WarningContent error={configInfo.error} />
          </WarningPanel>
        </Box>
      )}
      <Box bg="neutral" p="4">
        <ReactJson
          src={configInfo.config as object}
          name="config"
          enableClipboard={false}
          theme={isDark ? 'chalk' : 'rjv-default'}
        />
      </Box>
    </Box>
  );
};
