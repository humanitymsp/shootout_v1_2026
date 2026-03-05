import { getClient } from './api';
import { format, startOfYear, endOfYear, eachMonthOfInterval, isWithinInterval } from 'date-fns';
import { log, logError } from './logger';

export interface YearEndReport {
  year: number;
  summary: {
    totalDoorFees: number;
    totalRefunds: number;
    netRevenue: number;
    totalCheckIns: number;
    totalRefundsCount: number;
    uniquePlayers: number;
    averageDoorFee: number;
  };
  monthlyBreakdown: Array<{
    month: string;
    doorFees: number;
    refunds: number;
    netRevenue: number;
    checkIns: number;
    refundsCount: number;
    uniquePlayers: number;
  }>;
  topPlayers: Array<{
    name: string;
    checkIns: number;
    totalSpent: number;
    averageFee: number;
  }>;
  paymentMethods: Array<{
    method: string;
    count: number;
    total: number;
    percentage: number;
  }>;
}

/**
 * Generate comprehensive year-end report for financial and operational analysis
 */
export async function generateYearEndReport(year: number): Promise<YearEndReport> {
  const client = getClient();
  
  try {
    log(`Generating year-end report for ${year}`);
    
    // Get all check-ins for the year
    const yearStart = startOfYear(new Date(year, 0, 1)).toISOString();
    const yearEnd = endOfYear(new Date(year, 11, 31)).toISOString();
    
    // Fetch all check-ins for the year
    const checkInsResult = await client.models.CheckIn.list({
      filter: {
        and: [
          { checkinTime: { ge: yearStart } },
          { checkinTime: { le: yearEnd } },
        ],
      },
      limit: 10000, // Adjust based on expected volume
    });
    
    const allCheckIns = checkInsResult.data || [];
    log(`Found ${allCheckIns.length} check-ins for ${year}`);
    
    // Fetch all refunds for the year
    const refundsResult = await client.models.Refund.list({
      filter: {
        and: [
          { refundedAt: { ge: yearStart } },
          { refundedAt: { le: yearEnd } },
        ],
      },
      limit: 10000,
    });
    
    const allRefunds = refundsResult.data || [];
    log(`Found ${allRefunds.length} refunds for ${year}`);
    
    // Get player information
    const uniquePlayerIds = [...new Set(allCheckIns.map(ci => ci.playerId))];
    const playersResult = await client.models.Player.list({
      filter: {
        id: { in: uniquePlayerIds },
      },
      limit: 10000,
    });
    
    const players = playersResult.data || [];
    const playerMap = new Map(players.map(p => [p.id, p]));
    
    // Calculate summary
    const totalDoorFees = allCheckIns.reduce((sum, ci) => sum + ci.doorFeeAmount, 0);
    const totalRefunds = allRefunds.reduce((sum, r) => sum + r.amount, 0);
    const netRevenue = totalDoorFees - totalRefunds;
    const averageDoorFee = allCheckIns.length > 0 ? totalDoorFees / allCheckIns.length : 0;
    
    // Monthly breakdown
    const months = eachMonthOfInterval({
      start: new Date(year, 0, 1),
      end: new Date(year, 11, 31),
    });
    
    const monthlyBreakdown = months.map(month => {
      const monthStart = month.toISOString();
      const monthEnd = endOfYear(month).toISOString();
      
      const monthCheckIns = allCheckIns.filter(ci => 
        isWithinInterval(new Date(ci.checkinTime), { start: month, end: endOfYear(month) })
      );
      const monthRefunds = allRefunds.filter(r =>
        isWithinInterval(new Date(r.refundedAt), { start: month, end: endOfYear(month) })
      );
      
      const monthDoorFees = monthCheckIns.reduce((sum, ci) => sum + ci.doorFeeAmount, 0);
      const monthRefundAmount = monthRefunds.reduce((sum, r) => sum + r.amount, 0);
      const monthUniquePlayers = new Set(monthCheckIns.map(ci => ci.playerId)).size;
      
      return {
        month: format(month, 'MMM yyyy'),
        doorFees: monthDoorFees,
        refunds: monthRefundAmount,
        netRevenue: monthDoorFees - monthRefundAmount,
        checkIns: monthCheckIns.length,
        refundsCount: monthRefunds.length,
        uniquePlayers: monthUniquePlayers,
      };
    });
    
    // Top players analysis
    const playerStats = new Map<string, { checkIns: number; totalSpent: number; name: string }>();
    
    allCheckIns.forEach(ci => {
      const player = playerMap.get(ci.playerId);
      const name = (player as any)?.nick || (player as any)?.name || 'Unknown';
      const current = playerStats.get(ci.playerId) || { checkIns: 0, totalSpent: 0, name };
      
      playerStats.set(ci.playerId, {
        checkIns: current.checkIns + 1,
        totalSpent: current.totalSpent + ci.doorFeeAmount,
        name,
      });
    });
    
    // Subtract refunds from player totals
    allRefunds.forEach(refund => {
      const checkIn = allCheckIns.find(ci => ci.id === refund.checkinId);
      if (checkIn) {
        const stats = playerStats.get(checkIn.playerId);
        if (stats) {
          stats.totalSpent -= refund.amount;
        }
      }
    });
    
    const topPlayers = Array.from(playerStats.entries())
      .map(([_, stats]) => ({
        ...stats,
        averageFee: stats.checkIns > 0 ? stats.totalSpent / stats.checkIns : 0,
      }))
      .sort((a, b) => b.totalSpent - a.totalSpent)
      .slice(0, 20); // Top 20 players
    
    // Payment method analysis
    const paymentStats = new Map<string, { count: number; total: number }>();
    
    allCheckIns.forEach(ci => {
      const method = ci.paymentMethod || 'Unknown';
      const current = paymentStats.get(method) || { count: 0, total: 0 };
      paymentStats.set(method, {
        count: current.count + 1,
        total: current.total + ci.doorFeeAmount,
      });
    });
    
    const totalTransactions = allCheckIns.length;
    const paymentMethods = Array.from(paymentStats.entries())
      .map(([method, stats]) => ({
        method,
        count: stats.count,
        total: stats.total,
        percentage: totalTransactions > 0 ? (stats.count / totalTransactions) * 100 : 0,
      }))
      .sort((a, b) => b.total - a.total);
    
    const report: YearEndReport = {
      year,
      summary: {
        totalDoorFees,
        totalRefunds,
        netRevenue,
        totalCheckIns: allCheckIns.length,
        totalRefundsCount: allRefunds.length,
        uniquePlayers: uniquePlayerIds.length,
        averageDoorFee,
      },
      monthlyBreakdown,
      topPlayers,
      paymentMethods,
    };
    
    log(`Year-end report generated for ${year}: $${netRevenue.toFixed(2)} net revenue`);
    return report;
    
  } catch (error) {
    logError(`Failed to generate year-end report for ${year}:`, error);
    throw error;
  }
}

/**
 * Export year-end report to CSV format
 */
export function exportYearEndReportToCSV(report: YearEndReport): string {
  const lines: string[] = [];
  
  // Header
  lines.push(`Final Table Poker Club - Year End Report ${report.year}`);
  lines.push(`Generated: ${format(new Date(), 'PPP')}`);
  lines.push('');
  
  // Summary
  lines.push('SUMMARY');
  lines.push('Metric,Amount');
  lines.push(`Total Door Fees,$${report.summary.totalDoorFees.toFixed(2)}`);
  lines.push(`Total Refunds,$${report.summary.totalRefunds.toFixed(2)}`);
  lines.push(`Net Revenue,$${report.summary.netRevenue.toFixed(2)}`);
  lines.push(`Total Check-ins,${report.summary.totalCheckIns}`);
  lines.push(`Total Refunds,${report.summary.totalRefundsCount}`);
  lines.push(`Unique Players,${report.summary.uniquePlayers}`);
  lines.push(`Average Door Fee,$${report.summary.averageDoorFee.toFixed(2)}`);
  lines.push('');
  
  // Monthly Breakdown
  lines.push('MONTHLY BREAKDOWN');
  lines.push('Month,Door Fees,Refunds,Net Revenue,Check-ins,Refunds,Unique Players');
  report.monthlyBreakdown.forEach(month => {
    lines.push(`${month.month},$${month.doorFees.toFixed(2)},$${month.refunds.toFixed(2)},$${month.netRevenue.toFixed(2)},${month.checkIns},${month.refundsCount},${month.uniquePlayers}`);
  });
  lines.push('');
  
  // Top Players
  lines.push('TOP PLAYERS (by total spent)');
  lines.push('Rank,Name,Check-ins,Total Spent,Average Fee');
  report.topPlayers.forEach((player, index) => {
    lines.push(`${index + 1},"${player.name}",${player.checkIns},$${player.totalSpent.toFixed(2)},$${player.averageFee.toFixed(2)}`);
  });
  lines.push('');
  
  // Payment Methods
  lines.push('PAYMENT METHODS');
  lines.push('Method,Count,Total,Percentage');
  report.paymentMethods.forEach(method => {
    lines.push(`${method.method},${method.count},$${method.total.toFixed(2)},${method.percentage.toFixed(1)}%`);
  });
  
  return lines.join('\n');
}

/**
 * Export year-end report to printable HTML
 */
export function exportYearEndReportToHTML(report: YearEndReport): string {
  const formatCurrency = (amount: number) => `$${amount.toFixed(2)}`;
  
  return `
<!DOCTYPE html>
<html>
<head>
  <title>Final Table Poker Club - Year End Report ${report.year}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    h1, h2 { color: #333; }
    table { border-collapse: collapse; width: 100%; margin: 20px 0; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background-color: #f2f2f2; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 20px 0; }
    .metric { background: #f9f9f9; padding: 15px; border-radius: 5px; }
    .metric-value { font-size: 24px; font-weight: bold; color: #2c5282; }
    .metric-label { color: #666; margin-top: 5px; }
    @media print { body { margin: 10px; } }
  </style>
</head>
<body>
  <h1>Final Table Poker Club - Year End Report ${report.year}</h1>
  <p>Generated: ${format(new Date(), 'PPP')}</p>
  
  <h2>Summary</h2>
  <div class="summary">
    <div class="metric">
      <div class="metric-value">${formatCurrency(report.summary.totalDoorFees)}</div>
      <div class="metric-label">Total Door Fees</div>
    </div>
    <div class="metric">
      <div class="metric-value">${formatCurrency(report.summary.totalRefunds)}</div>
      <div class="metric-label">Total Refunds</div>
    </div>
    <div class="metric">
      <div class="metric-value">${formatCurrency(report.summary.netRevenue)}</div>
      <div class="metric-label">Net Revenue</div>
    </div>
    <div class="metric">
      <div class="metric-value">${report.summary.totalCheckIns}</div>
      <div class="metric-label">Total Check-ins</div>
    </div>
    <div class="metric">
      <div class="metric-value">${report.summary.uniquePlayers}</div>
      <div class="metric-label">Unique Players</div>
    </div>
    <div class="metric">
      <div class="metric-value">${formatCurrency(report.summary.averageDoorFee)}</div>
      <div class="metric-label">Average Door Fee</div>
    </div>
  </div>
  
  <h2>Monthly Breakdown</h2>
  <table>
    <tr><th>Month</th><th>Door Fees</th><th>Refunds</th><th>Net Revenue</th><th>Check-ins</th><th>Refunds</th><th>Unique Players</th></tr>
    ${report.monthlyBreakdown.map(month => `
      <tr>
        <td>${month.month}</td>
        <td>${formatCurrency(month.doorFees)}</td>
        <td>${formatCurrency(month.refunds)}</td>
        <td>${formatCurrency(month.netRevenue)}</td>
        <td>${month.checkIns}</td>
        <td>${month.refundsCount}</td>
        <td>${month.uniquePlayers}</td>
      </tr>
    `).join('')}
  </table>
  
  <h2>Top 20 Players (by total spent)</h2>
  <table>
    <tr><th>Rank</th><th>Name</th><th>Check-ins</th><th>Total Spent</th><th>Average Fee</th></tr>
    ${report.topPlayers.map((player, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${player.name}</td>
        <td>${player.checkIns}</td>
        <td>${formatCurrency(player.totalSpent)}</td>
        <td>${formatCurrency(player.averageFee)}</td>
      </tr>
    `).join('')}
  </table>
  
  <h2>Payment Methods</h2>
  <table>
    <tr><th>Method</th><th>Count</th><th>Total</th><th>Percentage</th></tr>
    ${report.paymentMethods.map(method => `
      <tr>
        <td>${method.method}</td>
        <td>${method.count}</td>
        <td>${formatCurrency(method.total)}</td>
        <td>${method.percentage.toFixed(1)}%</td>
      </tr>
    `).join('')}
  </table>
</body>
</html>`;
}

/**
 * Get available years for reporting (based on existing data)
 */
export async function getAvailableReportYears(): Promise<number[]> {
  const client = getClient();
  
  try {
    // Get the earliest check-in date
    const checkInsResult = await client.models.CheckIn.list({
      limit: 1,
      sort: { field: 'checkinTime', direction: 'ASC' },
    });
    
    if (!checkInsResult.data || checkInsResult.data.length === 0) {
      return [new Date().getFullYear()];
    }
    
    const earliestYear = new Date(checkInsResult.data[0].checkinTime).getFullYear();
    const currentYear = new Date().getFullYear();
    
    const years = [];
    for (let year = currentYear; year >= earliestYear; year--) {
      years.push(year);
    }
    
    return years;
  } catch (error) {
    logError('Failed to get available report years:', error);
    return [new Date().getFullYear()];
  }
}
