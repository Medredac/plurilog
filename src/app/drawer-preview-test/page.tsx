'use client';

import React, { useState } from 'react';
import { DocumentPreviewDrawer } from '@/components/DocumentPreviewDrawer';

export default function DrawerPreviewTestPage() {
  const [open, setOpen] = useState(true);

  return (
    <main className="min-h-screen bg-zinc-50 p-8">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white"
      >
        Open document
      </button>

      <DocumentPreviewDrawer
        isOpen={open}
        onClose={() => setOpen(false)}
        documentUrl="https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"
        filename="Project proposal.pdf"
      />
    </main>
  );
}
