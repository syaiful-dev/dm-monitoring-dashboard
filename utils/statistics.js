// Statistical utility functions for anomaly detection

/**
 * Calculate the arithmetic mean of an array of numbers
 */
function calculateMean(values) {
  if (!values || values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Calculate the standard deviation of an array of numbers
 */
function calculateStdDev(values) {
  if (!values || values.length < 2) return 0;
  const mean = calculateMean(values);
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  const variance = squaredDiffs.reduce((sum, v) => sum + v, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Calculate the z-score for a given value
 */
function calculateZScore(value, mean, stdDev) {
  if (stdDev === 0) return 0;
  return (value - mean) / stdDev;
}

/**
 * Simple linear regression: y = slope * x + intercept
 * xValues and yValues must be same length numeric arrays
 * Returns { slope, intercept, rSquared }
 */
function linearRegression(xValues, yValues) {
  if (!xValues || !yValues || xValues.length < 2) {
    return { slope: 0, intercept: 0, rSquared: 0 };
  }

  const n = xValues.length;
  const sumX = xValues.reduce((s, v) => s + v, 0);
  const sumY = yValues.reduce((s, v) => s + v, 0);
  const sumXY = xValues.reduce((s, v, i) => s + v * yValues[i], 0);
  const sumX2 = xValues.reduce((s, v) => s + v * v, 0);
  const sumY2 = yValues.reduce((s, v) => s + v * v, 0);

  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) return { slope: 0, intercept: 0, rSquared: 0 };

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;

  // R-squared
  const meanY = sumY / n;
  const ssTotal = sumY2 - n * meanY * meanY;
  const ssResidual = yValues.reduce((s, y, i) => {
    const predicted = slope * xValues[i] + intercept;
    return s + Math.pow(y - predicted, 2);
  }, 0);

  const rSquared = ssTotal === 0 ? 0 : 1 - ssResidual / ssTotal;

  return { slope, intercept, rSquared };
}

/**
 * Calculate reliability score (ratio of on-time to total)
 */
function calculateReliabilityScore(onTime, total) {
  if (total === 0) return 0;
  return Math.round((onTime / total) * 100) / 100;
}

module.exports = {
  calculateMean,
  calculateStdDev,
  calculateZScore,
  linearRegression,
  calculateReliabilityScore
};
