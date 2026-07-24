import { CLIENT_VERSION_HEADER } from '@lobechat/const';
import { describe, expect, it } from 'vitest';

import { parseClientMetadata } from '../clientMetadata';

describe('parseClientMetadata', () => {
  it('should parse the current iOS mobile user agent', () => {
    const headers = new Headers({
      'user-agent': 'LobeHub-Mobile/ios-v1.2.0',
    });

    expect(parseClientMetadata(headers)).toEqual({
      platform: 'ios',
      type: 'mobile',
      version: '1.2.0',
    });
  });

  it('should parse the current Android mobile user agent', () => {
    const headers = new Headers({
      'user-agent': 'LobeHub-Mobile/android-v2.0.0-beta.1',
    });

    expect(parseClientMetadata(headers)).toEqual({
      platform: 'android',
      type: 'mobile',
      version: '2.0.0-beta.1',
    });
  });

  it('should parse the desktop user agent', () => {
    const headers = new Headers({
      'user-agent': 'LobeHub Desktop/1.2.3',
    });

    expect(parseClientMetadata(headers)).toEqual({
      type: 'desktop',
      version: '1.2.3',
    });
  });

  it.each([
    ['LobeHub-iOS/2.0', '2.0'],
    ['LobeHub/1 CFNetwork/3860.300.31 Darwin/25.3.0', '1'],
  ])('should parse a legacy iOS user agent', (userAgent, version) => {
    expect(parseClientMetadata(new Headers({ 'user-agent': userAgent }))).toEqual({
      platform: 'ios',
      type: 'mobile',
      version,
    });
  });

  it('should identify an Android okhttp request without inventing an app version', () => {
    const headers = new Headers({ 'user-agent': 'okhttp/4.12.0' });

    expect(parseClientMetadata(headers)).toEqual({
      platform: 'android',
      type: 'mobile',
    });
  });

  it('should identify a web request from the client version header', () => {
    const headers = new Headers({
      [CLIENT_VERSION_HEADER]: '2.2.10',
      'user-agent': 'Mozilla/5.0 Chrome/140.0.0.0',
    });

    expect(parseClientMetadata(headers)).toEqual({
      type: 'web',
      version: '2.2.10',
    });
  });

  it('should prefer a native user agent over the web version header', () => {
    const headers = new Headers({
      [CLIENT_VERSION_HEADER]: '2.2.10',
      'user-agent': 'LobeHub Desktop/1.2.3',
    });

    expect(parseClientMetadata(headers)).toEqual({
      type: 'desktop',
      version: '1.2.3',
    });
  });

  it('should return unknown when no supported client metadata exists', () => {
    const headers = new Headers({ 'user-agent': 'curl/8.7.1' });

    expect(parseClientMetadata(headers)).toEqual({ type: 'unknown' });
  });

  it('should ignore an empty or oversized web version', () => {
    const emptyVersionHeaders = new Headers({ [CLIENT_VERSION_HEADER]: '   ' });
    const oversizedVersionHeaders = new Headers({
      [CLIENT_VERSION_HEADER]: '1'.repeat(129),
    });

    expect(parseClientMetadata(emptyVersionHeaders)).toEqual({ type: 'unknown' });
    expect(parseClientMetadata(oversizedVersionHeaders)).toEqual({ type: 'unknown' });
  });
});
