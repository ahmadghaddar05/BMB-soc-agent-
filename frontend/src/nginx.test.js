// @vitest-environment node

import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, expect, it } from 'vitest';

const nginxConfig = readFileSync(new URL('../nginx.conf', import.meta.url), 'utf8');

describe('frontend Nginx routing', () => {
  it('serves the Assets React route instead of Vite\'s physical asset directory', () => {
    expect(nginxConfig).toMatch(/location = \/assets\s*\{\s*try_files \/index\.html =404;/);
    expect(nginxConfig).toMatch(/location = \/assets\/\s*\{\s*return 308 \/assets;/);
  });

  it('keeps the general single-page application fallback', () => {
    expect(nginxConfig).toContain('try_files $uri $uri/ /index.html;');
  });
});
