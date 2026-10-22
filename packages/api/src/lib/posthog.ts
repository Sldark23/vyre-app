import { env } from '../env';

// PostHog client for server-side analytics
// Uses PostHog Node.js client API

interface PostHogEvent {
  event: string;
  distinct_id: string;
  properties?: Record<string, any>;
  timestamp?: string;
}

interface PostHogBatch {
  api_key: string;
  batch: PostHogEvent[];
}

class PostHogClient {
  private apiKey: string;
  private host: string;
  private enabled: boolean;
  private queue: PostHogEvent[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private readonly batchSize = 100;
  private readonly flushMs = 10000;

  constructor() {
    this.apiKey = env.posthogApiKey;
    this.host = env.posthogHost;
    this.enabled = env.posthogEnabled && !!this.apiKey;
    
    if (this.enabled) {
      this.startFlushTimer();
      console.log('[PostHog] Enabled, sending to', this.host);
    } else {
      console.log('[PostHog] Disabled (set VYRE_POSTHOG_ENABLED=1 and VYRE_POSTHOG_API_KEY to enable)');
    }
  }

  private startFlushTimer() {
    this.flushInterval = setInterval(() => this.flush(), this.flushMs);
    this.flushInterval.unref(); // Don't block process exit
  }

  capture(event: string, distinctId: string, properties?: Record<string, any>) {
    if (!this.enabled) return;
    
    this.queue.push({
      event,
      distinct_id: distinctId,
      properties: {
        ...properties,
        $lib: 'vyre-api',
        $lib_version: '1.0.0',
      },
      timestamp: new Date().toISOString(),
    });

    if (this.queue.length >= this.batchSize) {
      this.flush();
    }
  }

  async flush() {
    if (!this.enabled || this.queue.length === 0) return;
    
    const batch = this.queue.splice(0, this.batchSize);
    const payload: PostHogBatch = {
      api_key: this.apiKey,
      batch,
    };

    try {
      const res = await fetch(`${this.host}/batch/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      
      if (!res.ok) {
        console.warn('[PostHog] Flush failed:', res.status, await res.text());
        // Re-queue on failure
        this.queue.unshift(...batch);
      }
    } catch (err) {
      console.warn('[PostHog] Flush error:', err);
      this.queue.unshift(...batch);
    }
  }

  // Identify user with traits
  identify(distinctId: string, traits?: Record<string, any>) {
    this.capture('$identify', distinctId, traits);
  }

  // Alias old ID to new ID
  alias(alias: string, distinctId: string) {
    this.capture('$create_alias', distinctId, { alias });
  }

  shutdown() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    this.flush(); // Final flush
  }
}

// Singleton instance
export const posthog = new PostHogClient();

// Helper functions for common Vyre events
export function trackUserRegistered(userId: string, email: string, username: string) {
  posthog.capture('user_registered', userId, { email, username });
}

export function trackUserLoggedIn(userId: string, method: 'password' | 'biometric' = 'password') {
  posthog.capture('user_logged_in', userId, { method });
}

export function trackClusterCreated(userId: string, clusterId: string, memberCount: number) {
  posthog.capture('cluster_created', userId, { cluster_id: clusterId, member_count: memberCount });
}

export function trackChannelCreated(userId: string, clusterId: string, channelId: string, type: string) {
  posthog.capture('channel_created', userId, { cluster_id: clusterId, channel_id: channelId, type });
}

export function trackMessageSent(userId: string, channelId: string, hasAttachment: boolean) {
  posthog.capture('message_sent', userId, { channel_id: channelId, has_attachment: hasAttachment });
}

export function trackVoiceJoined(userId: string, channelId: string) {
  posthog.capture('voice_joined', userId, { channel_id: channelId });
}

export function trackFriendRequestSent(userId: string, targetUserId: string) {
  posthog.capture('friend_request_sent', userId, { target_user_id: targetUserId });
}

export function trackDMCreated(userId: string, conversationId: string, isGroup: boolean) {
  posthog.capture('dm_created', userId, { conversation_id: conversationId, is_group: isGroup });
}

export function trackVyrePlusCheckout(userId: string, preapprovalId: string) {
  posthog.capture('vyre_plus_checkout', userId, { preapproval_id: preapprovalId });
}

export function trackVyrePlusActivated(userId: string) {
  posthog.capture('vyre_plus_activated', userId);
}

export function trackSearchPerformed(userId: string, channelId: string, resultsCount: number) {
  posthog.capture('search_performed', userId, { channel_id: channelId, results_count: resultsCount });
}