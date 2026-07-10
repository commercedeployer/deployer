/** Deploy slotKey and labels — containerName + template used at deploy. */

const INSTANCE_LABEL = 'deployer.containerName';
const TEMPLATE_LABEL = 'deployer.templateId';

function trimParam(v) {
  if (v == null) return '';
  return String(v).trim();
}

function resolveSlotKey(containerName) {
  return trimParam(containerName) || 'deploy';
}

function normalizeDockerContainerName(containerName) {
  const raw = trimParam(containerName);
  if (!raw) throw new Error('containerName required');
  const name = raw.replace(/\s+/g, '-').toLowerCase().slice(0, 64);
  if (!name) throw new Error('containerName invalid');
  return name;
}

function templateIdFromLabels(labels) {
  if (!labels || typeof labels !== 'object') return '';
  return trimParam(labels[TEMPLATE_LABEL]);
}

module.exports = {
  INSTANCE_LABEL,
  TEMPLATE_LABEL,
  resolveSlotKey,
  normalizeDockerContainerName,
  templateIdFromLabels,
};
