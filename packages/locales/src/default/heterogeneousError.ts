export default {
  'heterogeneous.auth_required.title': 'Sign-in required',
  'heterogeneous.auth_required.description':
    'Ask the bot owner to sign in again on the device running {{agent}}.',
  'heterogeneous.usage_limit.title': 'Usage limit reached',
  'heterogeneous.usage_limit.description':
    'The account used by {{agent}} has exhausted its allowance. Wait for the quota to reset, or ask the bot owner to switch to an account or model with available quota.',
  'heterogeneous.credit_limit.title': 'Credits exhausted',
  'heterogeneous.credit_limit.description':
    'Ask the bot owner to add credits to the account used by {{agent}}, or switch models. Waiting for a quota reset will not restore these credits.',
  'heterogeneous.server_overloaded.title': 'Provider temporarily unavailable',
  'heterogeneous.server_overloaded.description':
    'The provider behind {{agent}} is busy or unavailable. Please try again shortly.',
  'heterogeneous.server_throttle.title': 'Requests temporarily limited',
  'heterogeneous.server_throttle.description':
    'The provider is temporarily limiting requests from {{agent}}. Please wait a moment and try again.',
  'heterogeneous.network_drop.title': 'Connection interrupted',
  'heterogeneous.network_drop.description':
    '{{agent}} lost its connection before finishing. Retry; if it happens again, ask the bot owner to check the running device’s network and proxy settings.',
  'heterogeneous.invalid_request.title': 'Request rejected',
  'heterogeneous.invalid_request.description':
    'The provider rejected the request sent by {{agent}}. Try a new topic; if it persists, share the Operation ID with support.',
  'heterogeneous.unsupported_attachment.title': 'Attachment unsupported',
  'heterogeneous.unsupported_attachment.description':
    '{{agent}} could not read an attachment. Remove it or convert it to a supported format, then resend the request.',
  'heterogeneous.aborted.title': 'Task stopped',
  'heterogeneous.aborted.description':
    'This {{agent}} task was stopped. Send a new request when you want to continue.',
  'heterogeneous.max_turns.title': 'Step limit reached',
  'heterogeneous.max_turns.description':
    '{{agent}} reached its step limit before finishing. Split the task into smaller steps, or ask the bot owner to adjust the limit.',
  'heterogeneous.resume_thread_not_found.title': 'Previous session unavailable',
  'heterogeneous.resume_thread_not_found.description':
    '{{agent}} could not find the previous session. Start a new topic and resend the request.',
  'heterogeneous.resume_cwd_mismatch.title': 'Session directory changed',
  'heterogeneous.resume_cwd_mismatch.description':
    'Ask the bot owner to restore the working directory used by this {{agent}} session, or start a new topic.',
  'heterogeneous.cli_not_found.title': 'Agent CLI unavailable',
  'heterogeneous.cli_not_found.description':
    'Ask the bot owner to install or repair {{agent}} on the device running this task.',
  'heterogeneous.working_directory_not_found.title': 'Working directory unavailable',
  'heterogeneous.working_directory_not_found.description':
    'The working directory for {{agent}} is missing. Ask the bot owner to restore it or choose an existing directory.',
  'heterogeneous.model_unavailable.title': 'Model unavailable',
  'heterogeneous.model_unavailable.description':
    'The model selected for {{agent}} is unavailable. Ask the bot owner to choose another model.',
  'heterogeneous.agent_failed.title': 'Agent task failed',
  'heterogeneous.agent_failed.description':
    '{{agent}} stopped without a recognized cause. Share the Operation ID with the bot owner or support to investigate.',
  'heterogeneous.reset': 'Quota resets at {{time}} (UTC).',
  'heterogeneous.window.seven_day': 'Weekly allowance exhausted.',
  'heterogeneous.window.five_hour': 'Session allowance exhausted.',
};
