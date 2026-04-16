import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../supabase";
import "./Payroll.css";

export default function Payroll({ user }) {
  const [payrollHistory, setPayrollHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  // Helper to convert month number (1-12) to Name
  const getMonthName = (monthNumber) => {
    const date = new Date();
    date.setMonth(monthNumber - 1);
    return date.toLocaleString("en-US", { month: "long" });
  };

  // Memoized fetch function
  const fetchMyPayroll = useCallback(async () => {
    if (!user?.id) return;
    try {
      setLoading(true);
      
      const { data, error } = await supabase
        .from("payroll_history")
        .select(`
          *,
          employees (*)
        `)
        .eq("employee_id", user.id) 
        .order("year", { ascending: false })
        .order("month", { ascending: false });

      if (error) throw error;
      setPayrollHistory(data || []);
    } catch (err) {
      console.error("Error fetching payroll:", err.message);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchMyPayroll();
  }, [fetchMyPayroll]);

  const handleDownloadSlip = (record) => {
    const emp = record.employees || {};
    const printWindow = window.open('', '_blank');
    const formatCurrency = (num) => `₹${(num ?? 0).toLocaleString('en-IN')}`;

    // Calculate Basic Salary by subtracting reimbursement from the total paid
    const basicSalary = (record.amount_paid || 0) - (record.reimbursement || 0);

    printWindow.document.write(`
      <html>
        <head>
          <title>Payslip - ${getMonthName(record.month)} ${record.year}</title>
          <style>
            body { font-family: 'Segoe UI', Tahoma, sans-serif; padding: 40px; color: #333; line-height: 1.6; }
            .slip-border { border: 2px solid #1e293b; padding: 30px; max-width: 850px; margin: auto; box-shadow: 0 0 10px rgba(0,0,0,0.1); }
            .header { text-align: center; border-bottom: 3px solid #1e293b; margin-bottom: 25px; padding-bottom: 15px; }
            .company-name { font-size: 26px; font-weight: bold; color: #1e293b; margin: 0; }
            .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-bottom: 30px; }
            .info-item { font-size: 14px; margin-bottom: 8px; }
            .label { font-weight: bold; color: #64748b; margin-right: 10px; }
            .salary-table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            .salary-table th { background: #f1f5f9; border: 1px solid #cbd5e1; padding: 12px; text-align: left; }
            .salary-table td { border: 1px solid #cbd5e1; padding: 12px; }
            .net-pay-box { margin-top: 30px; padding: 20px; background: #f8fafc; border: 2px dashed #1e293b; display: flex; justify-content: space-between; align-items: center; }
            .footer { margin-top: 50px; font-size: 12px; color: #94a3b8; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 20px; }
            @media print { .no-print { display: none; } body { padding: 0; } .slip-border { border: 1px solid #000; box-shadow: none; } }
          </style>
        </head>
        <body>
          <div class="slip-border">
            <div class="header">
              <div class="company-name">Cerevyn Solutions Private Limited</div>
              <div style="font-size: 12px;">Shaikpet, Hyderabad-500081, Telangana</div>
              <h2 style="margin-top: 15px; text-transform: uppercase; letter-spacing: 1px;">Payslip: ${getMonthName(record.month)} ${record.year}</h2>
            </div>
            
            <div class="info-grid">
              <div>
                <div class="info-item"><span class="label">Employee Name:</span> ${emp.first_name || ''} ${emp.last_name || ''}</div>
                <div class="info-item"><span class="label">Employee ID:</span> ${emp.employee_id || 'N/A'}</div>
                <div class="info-item"><span class="label">Designation:</span> ${emp.designation || 'Software Engineer'}</div>
              </div>
              <div>
                <div class="info-item"><span class="label">Bank Name:</span> ${emp.bank_name || 'N/A'}</div>
                <div class="info-item"><span class="label">Account No:</span> ${emp.bank_account || 'N/A'}</div>
                <div class="info-item"><span class="label">PAN No:</span> ${emp.pan_no || 'N/A'}</div>
              </div>
            </div>

            <table class="salary-table">
              <thead>
                <tr><th>Description</th><th style="text-align: right;">Amount</th></tr>
              </thead>
              <tbody>
                <tr><td>Basic Monthly Salary (Based on Attendance)</td><td style="text-align: right;">${formatCurrency(basicSalary)}</td></tr>
                <tr><td style="color: #10b981;">Reimbursement</td><td style="text-align: right; color: #10b981;">+ ${formatCurrency(record.reimbursement)}</td></tr>
                <tr style="font-weight: bold; background: #f8fafc;">
                  <td>Total Net Payable</td>
                  <td style="text-align: right;">${formatCurrency(record.amount_paid)}</td>
                </tr>
              </tbody>
            </table>

            <div class="net-pay-box">
              <span style="font-weight: bold; font-size: 18px;">Net Salary Credited:</span>
              <span style="font-weight: bold; font-size: 24px; color: #10b981;">${formatCurrency(record.amount_paid)}</span>
            </div>

            <div class="footer">
              <p>This is a computer-generated document and does not require a physical signature.</p>
              <p>Generated on: ${new Date().toLocaleString('en-IN')}</p>
            </div>
          </div>
          <div style="text-align: center; margin-top: 30px;" class="no-print">
            <button onclick="window.print()" style="padding: 12px 35px; background: #1e293b; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; font-size: 16px;">Download as PDF</button>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  return (
    <div className="payroll-container">
      <div className="attendance-header">
        <h2 className="attendance-title">My Payroll & Payslips</h2>
        <p className="subtitle">View and download your monthly salary statements</p>
      </div>

      <div className="table-wrapper">
        <table className="attendance-table">
          <thead>
            <tr>
              <th>Month & Year</th>
              <th>Status</th>
              <th>Amount Credited</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="4" style={{ textAlign: "center", padding: "40px" }}>Loading records...</td></tr>
            ) : payrollHistory.length === 0 ? (
              <tr><td colSpan="4" style={{ textAlign: "center", padding: "40px" }}>No payslips found for your account.</td></tr>
            ) : (
              payrollHistory.map((record) => (
                <tr key={record.id}>
                  <td style={{ fontWeight: "600" }}>{getMonthName(record.month)} {record.year}</td>
                  <td><span className="status-badge" style={{ background: "#dcfce7", color: "#166534" }}>Released</span></td>
                  <td style={{ color: "#10b981", fontWeight: "bold" }}>
                    ₹{(record.amount_paid ?? 0).toLocaleString('en-IN')}
                  </td>
                  <td>
                    <button className="edit-btn" onClick={() => handleDownloadSlip(record)}>
                      Download Slip
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}