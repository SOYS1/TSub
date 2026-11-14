import { describe, expect, it, vi } from 'vitest';

vi.mock('../../functions/storage-adapter.js', () => ({
    StorageFactory: {
        createAdapter: vi.fn(),
        getStorageType: vi.fn(),
        resolveKV: () => null
    },
    STORAGE_TYPES: { KV: 'kv', D1: 'd1' }
}));

import {
    AUTO_MAIN_TOKEN,
    isAutoMainToken,
    isMainTokenAuthorized
} from '../../functions/modules/subscription/main-handler.js';

const UUID = '55dafd9a-f2ec-4c74-adf5-b9c72f0311de';

describe('full subscription token authorization', () => {
    it('exposes the legacy auto token constant', () => {
        expect(AUTO_MAIN_TOKEN).toBe('auto');
    });

    it('accepts well-formed generated tokens while mytoken is auto', () => {
        const config = { mytoken: 'auto' };
        expect(isMainTokenAuthorized(UUID, config)).toBe(true);
        expect(isMainTokenAuthorized('auto', config)).toBe(true);
        expect(isMainTokenAuthorized('my_custom-token.v2', config)).toBe(true);
    });

    it('accepts any well-formed token when mytoken is missing or blank', () => {
        expect(isMainTokenAuthorized(UUID, {})).toBe(true);
        expect(isMainTokenAuthorized(UUID, { mytoken: '   ' })).toBe(true);
    });

    it('rejects empty, malformed and overlong tokens in auto mode', () => {
        const config = { mytoken: 'auto' };
        expect(isMainTokenAuthorized('', config)).toBe(false);
        expect(isMainTokenAuthorized('   ', config)).toBe(false);
        expect(isMainTokenAuthorized('bad token', config)).toBe(false);
        expect(isMainTokenAuthorized('bad/token', config)).toBe(false);
        expect(isMainTokenAuthorized('bad?token', config)).toBe(false);
        expect(isMainTokenAuthorized('a'.repeat(129), config)).toBe(false);
    });

    it('enforces an exact match once a fixed token is configured', () => {
        const config = { mytoken: 'stable-token' };
        expect(isMainTokenAuthorized('stable-token', config)).toBe(true);
        expect(isMainTokenAuthorized(UUID, config)).toBe(false);
        expect(isMainTokenAuthorized('auto', config)).toBe(false);
        expect(isMainTokenAuthorized('', config)).toBe(false);
        expect(isMainTokenAuthorized('stable-token ', config)).toBe(false);
    });

    it('validates auto-mode tokens with the shared helper', () => {
        expect(isAutoMainToken(UUID)).toBe(true);
        expect(isAutoMainToken('')).toBe(false);
        expect(isAutoMainToken(null)).toBe(false);
        expect(isAutoMainToken('a b')).toBe(false);
    });
});
